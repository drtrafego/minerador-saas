import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/node";
import {
  outreachCampaigns,
  campaignLeads,
  type OutreachTouch,
} from "@/db/schema/outreach-campaigns";
import { leads as leadsTable } from "@/db/schema/leads";
import { outreachThreads, outreachMessages } from "@/db/schema/outreach";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type { CampaignSendPayload } from "@/lib/queue/types";
import { renderTemplate } from "@/lib/utils/template";
import { buildLeadVars } from "@/lib/utils/template-vars";
import {
  getBucketCount,
  incrementSendCount,
  dayBucket,
  type OutreachChannel,
} from "@/lib/outreach/rate-limit";
import { getChannelWarmup, restanteCanal, type WarmupChannel } from "@/lib/outreach/warmup";
import {
  sendWhatsAppAPIMessage,
  sendWhatsAppTemplate,
  loadWhatsAppAPICredential,
  WhatsAppAPINotConfiguredError,
} from "@/lib/clients/whatsapp-api";
import {
  parseTemplateVars,
  resolveTemplateBodyParams,
  renderTemplateBody,
} from "@/lib/utils/template-vars";
import {
  sendUazAPIMessage,
  loadUazAPICredential,
} from "@/lib/clients/whatsapp-uazapi";
import { sendBrevoEmail, BrevoNotConfiguredError } from "@/lib/clients/brevo";

// Canal da campanha de abordagem (espelha o enum de outreach-campaigns).
type CampaignChannel = "email" | "whatsapp" | "instagram_dm" | "linkedin_dm";

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function jitterSeconds(minSec: number, maxSec: number): number {
  if (maxSec <= minSec) return Math.max(0, minSec);
  return Math.floor(minSec + Math.random() * (maxSec - minSec));
}

// Proximo dia util ~08:00 BRT (11:00 UTC) para retomar apos estourar o dailyCap.
function secondsUntilNextDayMorning(now: Date): number {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(11, 0, 0, 0);
  return Math.max(60, Math.floor((d.getTime() - now.getTime()) / 1000));
}

async function reenqueue(campaignLeadId: string, startAfterSeconds: number) {
  const boss = await getBoss();
  const payload: CampaignSendPayload = { campaignLeadId };
  await boss.send(QUEUES.campaignSend, payload, {
    startAfter: Math.max(0, Math.floor(startAfterSeconds)),
  });
}

async function markCampaignLead(
  id: string,
  patch: Partial<typeof campaignLeads.$inferInsert>,
) {
  await db
    .update(campaignLeads)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(campaignLeads.id, id));
}

export async function handleCampaignSend(
  payload: CampaignSendPayload,
): Promise<void> {
  const { campaignLeadId } = payload;

  const clRows = await db
    .select()
    .from(campaignLeads)
    .where(eq(campaignLeads.id, campaignLeadId))
    .limit(1);
  const cl = clRows[0];
  if (!cl) {
    console.warn(`[campaign.send] campaign_lead ${campaignLeadId} nao encontrado`);
    return;
  }

  // Ja foi enviado/parado num passo anterior nao deve reprocessar acidentalmente.
  if (cl.status === "replied" || cl.status === "skipped" || cl.status === "failed") {
    console.log(
      `[campaign.send] campaign_lead ${campaignLeadId} em status ${cl.status}, skip`,
    );
    return;
  }

  const organizationId = cl.organizationId;

  const campRows = await db
    .select()
    .from(outreachCampaigns)
    .where(
      and(
        eq(outreachCampaigns.id, cl.outreachCampaignId),
        eq(outreachCampaigns.organizationId, organizationId),
      ),
    )
    .limit(1);
  const campaign = campRows[0];
  if (!campaign) {
    await markCampaignLead(cl.id, {
      status: "skipped",
      lastError: "campanha de abordagem nao encontrada",
    });
    return;
  }

  if (!campaign.active) {
    await markCampaignLead(cl.id, {
      status: "skipped",
      lastError: "campanha inativa",
    });
    return;
  }

  if (campaign.sendPaused) {
    // Pausa temporaria: tenta de novo em 30 min sem alterar o status.
    await reenqueue(cl.id, 30 * 60);
    return;
  }

  const leadRows = await db
    .select()
    .from(leadsTable)
    .where(
      and(
        eq(leadsTable.id, cl.leadId),
        eq(leadsTable.organizationId, organizationId),
      ),
    )
    .limit(1);
  const lead = leadRows[0];
  if (!lead) {
    await markCampaignLead(cl.id, {
      status: "failed",
      lastError: "lead nao encontrado",
    });
    return;
  }

  if (lead.doNotDisturb) {
    await markCampaignLead(cl.id, {
      status: "skipped",
      lastError: "lead com opt-out (do_not_disturb)",
    });
    return;
  }

  const sequence: OutreachTouch[] = Array.isArray(campaign.sequenceJson)
    ? campaign.sequenceJson
    : [];
  const touch = sequence[cl.step];
  if (!touch) {
    // Sequencia esgotada: nada mais a enviar.
    await markCampaignLead(cl.id, { status: "sent" });
    return;
  }

  const channel = campaign.channel as CampaignChannel;

  // Canais de DM por navegador ainda nao suportados neste caminho novo.
  if (channel === "instagram_dm" || channel === "linkedin_dm") {
    await markCampaignLead(cl.id, {
      status: "skipped",
      lastError: "canal ainda nao suportado",
    });
    return;
  }

  // dailyCap por campanha via send_counters (getBucketCount/incrementSendCount).
  const rlChannel = channel as OutreachChannel;
  const now = new Date();
  const dayCount = await getBucketCount(
    organizationId,
    campaign.id,
    rlChannel,
    dayBucket(now),
  );
  if (dayCount >= campaign.dailyCap) {
    await reenqueue(cl.id, secondsUntilNextDayMorning(now));
    return;
  }

  // Cap agregado por CANAL (warm-up), alem do dailyCap por campanha acima.
  // So aplica se a org tiver channel_warmup habilitado para o canal; sem
  // warm-up configurado, mantem o comportamento atual (so o dailyCap).
  const warmupChannel = channel as WarmupChannel;
  const warmup = await getChannelWarmup(organizationId, warmupChannel);
  if (warmup?.enabled) {
    const { restante } = await restanteCanal(organizationId, warmupChannel, now);
    if (restante <= 0) {
      await reenqueue(cl.id, secondsUntilNextDayMorning(now));
      return;
    }
  }

  const vars = buildLeadVars(lead);
  let body = renderTemplate(touch.body, vars);
  const subject =
    channel === "email"
      ? renderTemplate(touch.subject?.trim() || "Oportunidade", vars)
      : null;

  // Reaproveita thread existente do par (org, lead, canal) para o bot inbound
  // conseguir responder na mesma conversa nos follow-ups.
  const threadChannel = channel as "email" | "whatsapp";
  const externalThreadId =
    channel === "whatsapp"
      ? lead.phone
        ? normalizePhone(lead.phone)
        : null
      : lead.email
        ? lead.email.toLowerCase()
        : null;

  try {
    let externalMessageId: string | null = null;

    if (channel === "whatsapp") {
      if (!lead.phone) {
        await markCampaignLead(cl.id, {
          status: "failed",
          lastError: "lead sem telefone",
        });
        return;
      }
      const apiCred = await loadWhatsAppAPICredential(organizationId);
      const uazCred = apiCred ? null : await loadUazAPICredential(organizationId);
      if (!apiCred && !uazCred) {
        // Credencial ainda nao configurada: tenta de novo em 1h sem falhar.
        await reenqueue(cl.id, 60 * 60);
        return;
      }
      if (apiCred) {
        // Abordagem fria via Meta oficial exige template aprovado quando a campanha
        // o define. {{1}},{{2}}... sao preenchidos com campos do lead ou texto fixo.
        if (campaign.metaTemplateName) {
          const specs = parseTemplateVars(campaign.metaTemplateVars);
          const bodyParams = resolveTemplateBodyParams(specs, vars);
          body = campaign.metaTemplateBody
            ? renderTemplateBody(campaign.metaTemplateBody, bodyParams)
            : `[template ${campaign.metaTemplateName}] ${bodyParams.join(" | ")}`;
          const result = await sendWhatsAppTemplate({
            organizationId,
            phone: lead.phone,
            templateName: campaign.metaTemplateName,
            language: campaign.metaTemplateLang ?? "pt_BR",
            bodyParams,
          });
          externalMessageId = result.messageId;
        } else {
          const result = await sendWhatsAppAPIMessage({
            organizationId,
            phone: lead.phone,
            body,
          });
          externalMessageId = result.messageId;
        }
      } else {
        const result = await sendUazAPIMessage({
          organizationId,
          phone: lead.phone,
          body,
        });
        externalMessageId = result.messageId;
      }
    } else {
      // email
      if (!lead.email) {
        await markCampaignLead(cl.id, {
          status: "failed",
          lastError: "lead sem email",
        });
        return;
      }
      const result = await sendBrevoEmail({
        organizationId,
        to: lead.email,
        toName: lead.displayName ?? undefined,
        subject: subject ?? "Oportunidade",
        body,
      });
      externalMessageId = result.messageId || null;
    }

    // Cria/atualiza a thread e registra a mensagem outbound (metadata agent=false).
    const existingThread = await db
      .select()
      .from(outreachThreads)
      .where(
        and(
          eq(outreachThreads.organizationId, organizationId),
          eq(outreachThreads.leadId, lead.id),
          eq(outreachThreads.channel, threadChannel),
        ),
      )
      .orderBy(desc(outreachThreads.createdAt))
      .limit(1);

    let threadId: string;
    if (existingThread[0]) {
      threadId = existingThread[0].id;
      await db
        .update(outreachThreads)
        .set({
          status: "active",
          currentStep: cl.step,
          lastMessageAt: now,
          lastOutboundAt: now,
          externalThreadId:
            existingThread[0].externalThreadId ?? externalThreadId,
          updatedAt: now,
        })
        .where(eq(outreachThreads.id, threadId));
    } else {
      const [created] = await db
        .insert(outreachThreads)
        .values({
          organizationId,
          miningId: null,
          leadId: lead.id,
          channel: threadChannel,
          status: "active",
          currentStep: cl.step,
          lastMessageAt: now,
          lastOutboundAt: now,
          externalThreadId,
        })
        .returning({ id: outreachThreads.id });
      if (!created) throw new Error("falha ao criar outreach_thread");
      threadId = created.id;
    }

    await db.insert(outreachMessages).values({
      organizationId,
      threadId,
      direction: "outbound",
      status: "sent",
      step: cl.step,
      subject,
      body,
      externalMessageId,
      sentAt: now,
      metadata: {
        agent: false,
        source: "campaign",
        outreachCampaignId: campaign.id,
        campaignLeadId: cl.id,
      },
    });

    await incrementSendCount(organizationId, campaign.id, rlChannel, now);

    const nextStep = cl.step + 1;
    await markCampaignLead(cl.id, {
      status: "sent",
      step: nextStep,
      contactedAt: cl.contactedAt ?? now,
      lastError: null,
    });

    // Proximo toque da sequencia: reenfileira com delay de delayDays + jitter.
    const next = sequence[nextStep];
    if (next) {
      const delaySeconds =
        Math.max(0, next.delayDays) * 24 * 60 * 60 +
        jitterSeconds(
          campaign.sendIntervalMinSeconds,
          campaign.sendIntervalMaxSeconds,
        );
      await reenqueue(cl.id, delaySeconds);
    }
  } catch (err) {
    const transient =
      err instanceof WhatsAppAPINotConfiguredError ||
      err instanceof BrevoNotConfiguredError;
    const reason = err instanceof Error ? err.message : String(err);
    if (transient) {
      await reenqueue(cl.id, 60 * 60);
      return;
    }
    console.error(`[campaign.send] erro no campaign_lead ${cl.id}`, reason);
    await markCampaignLead(cl.id, { status: "failed", lastError: reason });
  }
}
