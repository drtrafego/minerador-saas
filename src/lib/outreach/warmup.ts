import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { sendCounters } from "@/db/schema/jobs";
import { channelWarmup, type ChannelWarmup } from "@/db/schema/outreach-automation";
import { dayBucket } from "@/lib/outreach/rate-limit";

// Canais que hoje entram na curva de aquecimento (warm-up) de envio.
export type WarmupChannel = "whatsapp" | "email";

// Quantos dias completos se passaram entre startedAt e hoje (min 0).
function diasDesde(startedAt: Date | string, hoje: Date): number {
  const start = new Date(startedAt);
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const hojeUtc = Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate());
  const diffMs = hojeUtc - startUtc;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * Cap do dia segundo a curva de aquecimento: comeca em startCap, sobe
 * stepSize a cada stepEveryDays dias desde startedAt, ate maxCap.
 * WhatsApp tambem trava pelo custo diario (costCapUsd / costPerMsgUsd).
 * Retorna 0 se o warm-up estiver desabilitado (enabled=false).
 */
export function capDiaWarmup(w: ChannelWarmup, hoje: Date = new Date()): number {
  if (!w.enabled) return 0;

  const stepEveryDays = Number(w.stepEveryDays);
  const dias = diasDesde(w.startedAt, hoje);
  const steps = stepEveryDays > 0 ? Math.floor(dias / stepEveryDays) : 0;

  let cap = w.startCap + w.stepSize * steps;
  cap = Math.min(cap, w.maxCap);
  cap = Math.max(cap, 0);

  if (w.channel === "whatsapp") {
    const costPerMsgUsd = Number(w.costPerMsgUsd);
    if (costPerMsgUsd > 0) {
      const capPorCusto = Math.floor(Number(w.costCapUsd) / costPerMsgUsd);
      cap = Math.min(cap, capPorCusto);
    }
  }

  return cap;
}

/**
 * Consumo do dia (hoje) de um canal para a org, somando todos os buckets
 * diarios de send_counters (independente de campaignId), usando a mesma
 * convencao de bucket 'd:YYYY-MM-DD' de dayBucket() (rate-limit.ts).
 */
export async function consumoHojeCanal(
  organizationId: string,
  channel: WarmupChannel,
  hoje: Date = new Date(),
): Promise<number> {
  const bucket = dayBucket(hoje);
  const rows = await db
    .select({ total: sql<string>`coalesce(sum(${sendCounters.count}), 0)` })
    .from(sendCounters)
    .where(
      and(
        eq(sendCounters.organizationId, organizationId),
        eq(sendCounters.channel, channel),
        eq(sendCounters.bucket, bucket),
      ),
    );
  return Number(rows[0]?.total ?? 0);
}

// Busca a configuracao de warm-up de um canal para a org. Retorna null se a
// org ainda nao configurou warm-up para esse canal (sem credencial/tabela).
export async function getChannelWarmup(
  organizationId: string,
  channel: WarmupChannel,
): Promise<ChannelWarmup | null> {
  const rows = await db
    .select()
    .from(channelWarmup)
    .where(
      and(
        eq(channelWarmup.organizationId, organizationId),
        eq(channelWarmup.channel, channel),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export type RestanteCanal = {
  capDia: number;
  consumo: number;
  restante: number;
  custoEstimadoUsd: number;
};

/**
 * Junta o cap do dia (warm-up da org+canal) com o consumo ja feito hoje e
 * retorna quanto ainda pode ser disparado, alem do custo estimado (whatsapp).
 * Se a org nao tiver warm-up configurado para o canal, capDia = 0.
 */
export async function restanteCanal(
  organizationId: string,
  channel: WarmupChannel,
  hoje: Date = new Date(),
): Promise<RestanteCanal> {
  const [warmup, consumo] = await Promise.all([
    getChannelWarmup(organizationId, channel),
    consumoHojeCanal(organizationId, channel, hoje),
  ]);

  const capDia = warmup ? capDiaWarmup(warmup, hoje) : 0;
  const restante = Math.max(0, capDia - consumo);
  const custoPorMsg = warmup ? Number(warmup.costPerMsgUsd) : 0;
  const custoEstimadoUsd = channel === "whatsapp" ? restante * custoPorMsg : 0;

  return { capDia, consumo, restante, custoEstimadoUsd };
}
