import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { minings } from "@/db/schema/minings";
import { leads as leadsTable } from "@/db/schema/leads";
import { qualificationJobs } from "@/db/schema/jobs";
import {
  qualifyLeadsBatch,
  type LeadForQualification,
} from "@/lib/clients/anthropic";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type { QualifyBatchPayload } from "@/lib/queue/types";

// Lote pequeno: o Gemini/Claude classifica todos com confiabilidade. Com 20, o
// Gemini as vezes decidia so parte do lote e o resto caia em "falha de classificacao".
const DEFAULT_BATCH_SIZE = 10;

const DEFAULT_PROMPT = [
  "Avalie se o lead corresponde ao perfil ideal de cliente.",
  "Aprove apenas leads com claros sinais de aderencia ao ICP.",
].join(" ");

/**
 * Sinal de contatabilidade calculado em codigo (nao pelo modelo): true se o lead tem
 * telefone, email, ou (para Instagram) um @ que permite DM direto.
 * Usado para: (a) informar o modelo no bloco do lead, (b) forcar needs_review no
 * pos-processamento quando nao ha nenhum canal de abordagem, independente do fit de ICP.
 */
// Um lead tem canal de abordagem se der para chegar nele por ALGUM meio:
// telefone (WhatsApp), email, @ do Instagram (DM) ou perfil do LinkedIn (DM/InMail).
// So cai em needs_review quem nao tem nenhum contato.
function computeHasContact(row: typeof leadsTable.$inferSelect): boolean {
  return !!(row.phone || row.email || row.handle || row.linkedinUrl);
}

function buildLeadForQualification(
  row: typeof leadsTable.$inferSelect,
): LeadForQualification {
  const raw = (row.rawData ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    source: row.source,
    displayName: row.displayName,
    handle: row.handle,
    website: row.website,
    phone: row.phone,
    email: row.email,
    city: row.city,
    region: row.region,
    country: row.country,
    headline: row.headline,
    company: row.company,
    linkedinUrl: row.linkedinUrl,
    bio: typeof raw.bio === "string" ? (raw.bio as string) : null,
    followers:
      typeof raw.followers === "number" ? (raw.followers as number) : null,
    category:
      typeof raw.category === "string" ? (raw.category as string) : null,
    rating: typeof raw.rating === "number" ? (raw.rating as number) : null,
    userRatingsTotal:
      typeof raw.userRatingsTotal === "number"
        ? (raw.userRatingsTotal as number)
        : null,
    types: Array.isArray(raw.types) ? (raw.types as string[]) : undefined,
    hasContact: computeHasContact(row),
  };
}

export async function handleQualifyBatch(
  payload: QualifyBatchPayload,
): Promise<void> {
  const { organizationId, miningId } = payload;
  const batchSize = payload.batchSize ?? DEFAULT_BATCH_SIZE;

  const miningRows = await db
    .select()
    .from(minings)
    .where(
      and(
        eq(minings.id, miningId),
        eq(minings.organizationId, organizationId),
      ),
    )
    .limit(1);
  const mining = miningRows[0];
  if (!mining) {
    throw new Error(`mineracao ${miningId} nao encontrada`);
  }

  const pendingLeads = await db
    .select()
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.organizationId, organizationId),
        eq(leadsTable.miningId, miningId),
        eq(leadsTable.qualificationStatus, "pending"),
      ),
    )
    .limit(batchSize);

  if (pendingLeads.length === 0) return;

  // Model bruto da mineracao (pode ser gemini-*, claude-*, ou vazio).
  // A decisao de provider e model real e feita dentro de qualifyLeadsBatch.
  const rawCampaignModel = (mining.qualificationModel ?? "").trim() || undefined;
  const prompt = mining.qualificationPrompt ?? DEFAULT_PROMPT;

  const inputs = pendingLeads.map((row) => buildLeadForQualification(row));

  // Placeholder para tracking: model real sera atualizado apos a chamada via result.model.
  const modelPlaceholder = rawCampaignModel ?? "auto";

  const jobIds: string[] = [];
  for (const lead of pendingLeads) {
    const [jobRow] = await db
      .insert(qualificationJobs)
      .values({
        organizationId,
        miningId,
        leadId: lead.id,
        status: "running",
        model: modelPlaceholder,
        startedAt: new Date(),
      })
      .returning({ id: qualificationJobs.id });
    if (jobRow) jobIds.push(jobRow.id);
  }

  let result;
  try {
    result = await qualifyLeadsBatch({
      organizationId,
      leads: inputs,
      prompt,
      rawCampaignModel,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failedAt = new Date();
    await db
      .update(leadsTable)
      .set({
        qualificationStatus: "needs_review",
        qualificationReason: `erro de qualificacao: ${message}`,
        updatedAt: failedAt,
      })
      .where(
        inArray(
          leadsTable.id,
          pendingLeads.map((l) => l.id),
        ),
      );
    for (const jobId of jobIds) {
      await db
        .update(qualificationJobs)
        .set({
          status: "failed",
          error: message,
          finishedAt: failedAt,
          updatedAt: failedAt,
        })
        .where(eq(qualificationJobs.id, jobId));
    }
    throw err;
  }

  const decisionByLead = new Map(
    result.decisions.map((d) => [d.leadId, d] as const),
  );

  const now = new Date();
  const sharedTokens = Math.floor(
    result.usage.inputTokens / Math.max(pendingLeads.length, 1),
  );
  const sharedOutput = Math.floor(
    result.usage.outputTokens / Math.max(pendingLeads.length, 1),
  );
  const sharedCost =
    result.usage.costUsd / Math.max(pendingLeads.length, 1);

  for (let i = 0; i < pendingLeads.length; i++) {
    const lead = pendingLeads[i];
    if (!lead) continue;
    const decision = decisionByLead.get(lead.id);
    const jobId = jobIds[i];

    if (!decision) {
      // Sem decisao do modelo para este lead: nao deixa "pending" para sempre
      // (evita reenfileirar o mesmo lead indefinidamente, gastando tokens a cada lote).
      await db
        .update(leadsTable)
        .set({
          qualificationStatus: "needs_review",
          qualificationReason: "Falha de classificacao (sem decisao do modelo)",
          updatedAt: now,
        })
        .where(eq(leadsTable.id, lead.id));
      if (jobId) {
        await db
          .update(qualificationJobs)
          .set({
            status: "failed",
            error: "claude nao retornou decisao para este lead",
            finishedAt: now,
            updatedAt: now,
          })
          .where(eq(qualificationJobs.id, jobId));
      }
      continue;
    }

    const hasContact = computeHasContact(lead);
    const baseStatus =
      decision.decision === "approved" ? "qualified" : "disqualified";
    // Regra dura: sem nenhum canal de contato, o lead nunca sai como "qualified",
    // mesmo com bom fit de ICP, porque o gargalo do negocio e contato, nao volume.
    const status = hasContact ? baseStatus : "needs_review";
    const reason = hasContact
      ? decision.reason
      : `Sem canal de contato. ${decision.reason}`;

    const temperature: "cold" | "warm" | "hot" =
      decision.score >= 70 ? "hot" : decision.score >= 40 ? "warm" : "cold";

    await db
      .update(leadsTable)
      .set({
        qualificationStatus: status,
        qualificationScore: decision.score,
        qualificationReason: reason,
        temperature,
        qualifiedAt: now,
        updatedAt: now,
      })
      .where(eq(leadsTable.id, lead.id));

    if (jobId) {
      await db
        .update(qualificationJobs)
        .set({
          status: "completed",
          // Atualiza model com o valor real resolvido pelo provider (gemini-2.5-flash, claude-sonnet-4-5, etc.)
          model: result.model,
          promptTokens: sharedTokens,
          completionTokens: sharedOutput,
          costUsd: sharedCost.toFixed(6),
          result: {
            decision: decision.decision,
            score: decision.score,
            reason,
          },
          finishedAt: now,
          updatedAt: now,
        })
        .where(eq(qualificationJobs.id, jobId));
    }
  }

  const remaining = await db
    .select({ id: leadsTable.id })
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.organizationId, organizationId),
        eq(leadsTable.miningId, miningId),
        eq(leadsTable.qualificationStatus, "pending"),
      ),
    )
    .limit(1);

  if (remaining.length > 0) {
    const boss = await getBoss();
    const next: QualifyBatchPayload = {
      organizationId,
      miningId,
      batchSize,
    };
    await boss.send(QUEUES.qualifyBatch, next, {
      singletonKey: `qualify:${organizationId}:${miningId}`,
      singletonNextSlot: true,
    });
  }
}
