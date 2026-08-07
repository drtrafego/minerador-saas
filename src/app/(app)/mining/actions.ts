"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { minings, miningSources } from "@/db/schema/minings";
import { requireOrg } from "@/lib/auth/guards";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type { ScrapeRunPayload } from "@/lib/queue/types";
import { generateIcpPrompt } from "@/lib/clients/anthropic";

const sourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("google_places"),
    query: z.string().min(1),
    location: z.string().optional(),
    locations: z.array(z.string().min(1)).max(60).optional(),
    radius: z.coerce.number().int().positive().optional(),
    maxResults: z.coerce.number().int().positive().max(200).optional(),
  }),
  z.object({
    type: z.literal("instagram_hashtag"),
    search: z.string().min(1),
    maxResults: z.coerce.number().int().positive().max(200).optional(),
    onlyBrazil: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("linkedin_search"),
    query: z.string().min(1),
    location: z.string().optional(),
    maxResults: z.coerce.number().int().positive().max(200).optional(),
  }),
]);

const createSchema = z.object({
  name: z.string().min(1).max(120),
  niche: z.string().min(1).max(200),
  qualificationPrompt: z.string().min(10),
  qualificationModel: z.string().min(1).default("claude-sonnet-4-5"),
  sources: z.array(sourceSchema).min(1).max(3),
});

export type CreateMiningInput = z.infer<typeof createSchema>;

export async function createMining(input: CreateMiningInput) {
  const { organizationId } = await requireOrg();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }

  const data = parsed.data;

  const result = await db.transaction(async (tx) => {
    const [mining] = await tx
      .insert(minings)
      .values({
        organizationId,
        name: data.name,
        niche: data.niche,
        qualificationPrompt: data.qualificationPrompt,
        qualificationModel: data.qualificationModel,
        status: "draft",
      })
      .returning({ id: minings.id });

    if (!mining) throw new Error("falha ao criar mineracao");

    for (const sourceData of data.sources) {
      const sourceConfig: Record<string, unknown> =
        sourceData.type === "google_places"
          ? {
              query: sourceData.query,
              location: sourceData.location,
              locations: sourceData.locations,
              radius: sourceData.radius,
              maxResults: sourceData.maxResults ?? 60,
            }
          : sourceData.type === "instagram_hashtag"
            ? {
                search: sourceData.search,
                maxResults: sourceData.maxResults ?? 30,
                onlyBrazil: sourceData.onlyBrazil ?? true,
              }
            : {
                query: sourceData.query,
                location: sourceData.location,
                maxResults: sourceData.maxResults ?? 50,
              };

      await tx.insert(miningSources).values({
        organizationId,
        miningId: mining.id,
        type: sourceData.type,
        config: sourceConfig,
      });
    }

    return { miningId: mining.id };
  });

  revalidatePath("/mining");
  return { ok: true, ...result };
}

export async function startMining(miningId: string) {
  const { organizationId } = await requireOrg();

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

  if (miningRows.length === 0) {
    return { error: "mineracao nao encontrada" };
  }

  const sources = await db
    .select()
    .from(miningSources)
    .where(
      and(
        eq(miningSources.miningId, miningId),
        eq(miningSources.organizationId, organizationId),
      ),
    );

  try {
    const boss = await getBoss();
    // Um unico job por mineracao: o handler roda TODAS as fontes em paralelo.
    // Antes era 1 job por fonte, e o worker podia pegar so o Google (lento) e
    // segurar LinkedIn/Instagram na fila.
    if (sources.length > 0) {
      const payload: ScrapeRunPayload = { organizationId, miningId };
      await boss.send(QUEUES.scrapeRun, payload);
    }

    await db
      .update(minings)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(minings.id, miningId));

    revalidatePath("/mining");
    revalidatePath(`/mining/${miningId}`);
    return { ok: true };
  } catch (err) {
    console.error("[startMining]", err);
    return { error: "falha ao iniciar mineracao, tente novamente" };
  }
}

export async function pauseMining(miningId: string) {
  const { organizationId } = await requireOrg();

  const found = await db
    .select({ id: minings.id })
    .from(minings)
    .where(
      and(
        eq(minings.id, miningId),
        eq(minings.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (found.length === 0) return { error: "mineracao nao encontrada" };

  await db
    .update(minings)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(minings.id, miningId));

  revalidatePath("/mining");
  revalidatePath(`/mining/${miningId}`);
  return { ok: true };
}

export async function resumeMining(miningId: string) {
  return startMining(miningId);
}

export async function deleteMining(miningId: string) {
  const { organizationId } = await requireOrg();

  const found = await db
    .select({ id: minings.id })
    .from(minings)
    .where(
      and(
        eq(minings.id, miningId),
        eq(minings.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (found.length === 0) return { error: "mineracao nao encontrada" };

  await db.delete(minings).where(eq(minings.id, miningId));
  revalidatePath("/mining");
  redirect("/mining");
}

// Gera um ICP a partir de uma descricao curta (botao "Gerar com IA" no Passo 3).
export async function generateIcp(
  descricao: string,
): Promise<{ prompt: string } | { error: string }> {
  const { organizationId } = await requireOrg();
  const desc = (descricao ?? "").trim();
  if (desc.length < 3) return { error: "descreva o cliente ideal em uma frase" };
  try {
    const prompt = await generateIcpPrompt({ organizationId, descricao: desc });
    if (!prompt) return { error: "nao consegui gerar, tente de novo" };
    return { prompt };
  } catch (err) {
    console.error("[generateIcp]", err);
    const msg = err instanceof Error ? err.message : String(err);
    if (/credencial|credential|api key|apikey/i.test(msg)) {
      return {
        error:
          "configure a credencial de IA (Anthropic) em Configuracoes para gerar o ICP",
      };
    }
    return { error: "falha ao gerar o ICP, tente novamente" };
  }
}

export async function createAndStartMining(input: CreateMiningInput) {
  const created = await createMining(input);
  if ("error" in created) return created;
  if (!created.ok || !created.miningId) return { error: "falha ao criar" };
  const started = await startMining(created.miningId);
  if ("error" in started && started.error) {
    return { ...created, startError: started.error };
  }
  return { ok: true, miningId: created.miningId };
}
