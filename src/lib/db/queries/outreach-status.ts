import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads } from "@/db/schema/leads";
import { outreachThreads } from "@/db/schema/outreach";

export type OutreachChannel = "whatsapp" | "email" | "instagram_dm" | "linkedin_dm";

const ALL_CHANNELS: OutreachChannel[] = ["whatsapp", "email", "instagram_dm", "linkedin_dm"];

export type ChannelStatus = {
  channel: OutreachChannel;
  abordado: boolean;
  respondido: boolean;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
};

/**
 * Retorna o status de abordagem por canal para um lead especifico.
 * - abordado: existe thread com lastOutboundAt preenchido.
 * - respondido: existe thread com lastInboundAt preenchido.
 */
export async function getChannelOutreachStatus(
  organizationId: string,
  leadId: string,
): Promise<ChannelStatus[]> {
  const rows = await db
    .select({
      channel: outreachThreads.channel,
      lastOutboundAt: outreachThreads.lastOutboundAt,
      lastInboundAt: outreachThreads.lastInboundAt,
    })
    .from(outreachThreads)
    .where(
      and(
        eq(outreachThreads.organizationId, organizationId),
        eq(outreachThreads.leadId, leadId),
        isNull(outreachThreads.deletedAt),
      ),
    );

  // Agrega por canal (pode haver multiplas threads no mesmo canal, pega a mais recente por lastOutboundAt)
  const byChannel = new Map<OutreachChannel, { lastOutboundAt: Date | null; lastInboundAt: Date | null }>();

  for (const row of rows) {
    const ch = row.channel as OutreachChannel;
    const existing = byChannel.get(ch);
    if (!existing) {
      byChannel.set(ch, {
        lastOutboundAt: row.lastOutboundAt,
        lastInboundAt: row.lastInboundAt,
      });
    } else {
      // mantém o lastOutboundAt mais recente
      const newOutbound = row.lastOutboundAt && (!existing.lastOutboundAt || row.lastOutboundAt > existing.lastOutboundAt)
        ? row.lastOutboundAt
        : existing.lastOutboundAt;
      const newInbound = row.lastInboundAt && (!existing.lastInboundAt || row.lastInboundAt > existing.lastInboundAt)
        ? row.lastInboundAt
        : existing.lastInboundAt;
      byChannel.set(ch, { lastOutboundAt: newOutbound, lastInboundAt: newInbound });
    }
  }

  return ALL_CHANNELS.map((channel) => {
    const data = byChannel.get(channel);
    return {
      channel,
      abordado: data?.lastOutboundAt != null,
      respondido: data?.lastInboundAt != null,
      lastOutboundAt: data?.lastOutboundAt ?? null,
      lastInboundAt: data?.lastInboundAt ?? null,
    };
  });
}

export type ChannelKpi = {
  channel: OutreachChannel;
  abordados: number;
  respostas: number;
  total: number;
  faltam: number;
};

/**
 * KPIs agregados por canal.
 * total = leads elegiveis (qualified ou needs_review, nao deletados).
 * abordados = threads distintas com lastOutboundAt != null.
 * respostas = threads distintas com lastInboundAt != null.
 * faltam = total - abordados (por conta de leads sem thread naquele canal).
 */
export async function getChannelKpis(
  organizationId: string,
  campaignId?: string,
): Promise<ChannelKpi[]> {
  // Total de leads elegiveis
  const totalConditions = and(
    eq(leads.organizationId, organizationId),
    isNull(leads.deletedAt),
    or(
      eq(leads.qualificationStatus, "qualified"),
      eq(leads.qualificationStatus, "needs_review"),
    ),
    campaignId ? eq(leads.miningId, campaignId) : undefined,
  );

  const [totalRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leads)
    .where(totalConditions);

  const total = totalRow?.c ?? 0;

  // Abordados e respostas por canal
  const threadConditions = and(
    eq(outreachThreads.organizationId, organizationId),
    isNull(outreachThreads.deletedAt),
    campaignId ? eq(outreachThreads.miningId, campaignId) : undefined,
  );

  const channelRows = await db
    .select({
      channel: outreachThreads.channel,
      abordados: sql<number>`count(distinct case when ${outreachThreads.lastOutboundAt} is not null then ${outreachThreads.leadId} end)::int`,
      respostas: sql<number>`count(distinct case when ${outreachThreads.lastInboundAt} is not null then ${outreachThreads.leadId} end)::int`,
    })
    .from(outreachThreads)
    .where(threadConditions)
    .groupBy(outreachThreads.channel);

  const byChannel = new Map(channelRows.map((r) => [r.channel as OutreachChannel, r]));

  return ALL_CHANNELS.map((channel) => {
    const data = byChannel.get(channel);
    const abordados = data?.abordados ?? 0;
    const respostas = data?.respostas ?? 0;
    return {
      channel,
      abordados,
      respostas,
      total,
      faltam: Math.max(0, total - abordados),
    };
  });
}

export type LeadThreadInfo = {
  leadId: string;
  channel: string;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  status: string;
};

/**
 * Retorna todas as threads de outreach para um conjunto de leadIds.
 * Usado pela tela de leads para mostrar badges de status por lead
 * sem fazer N queries individuais.
 */
export async function getThreadsForLeads(
  organizationId: string,
  leadIds: string[],
): Promise<LeadThreadInfo[]> {
  if (leadIds.length === 0) return [];

  const rows = await db
    .select({
      leadId: outreachThreads.leadId,
      channel: outreachThreads.channel,
      lastOutboundAt: outreachThreads.lastOutboundAt,
      lastInboundAt: outreachThreads.lastInboundAt,
      status: outreachThreads.status,
    })
    .from(outreachThreads)
    .where(
      and(
        eq(outreachThreads.organizationId, organizationId),
        inArray(outreachThreads.leadId, leadIds),
        isNull(outreachThreads.deletedAt),
      ),
    );

  return rows.map((r) => ({
    leadId: r.leadId,
    channel: r.channel,
    lastOutboundAt: r.lastOutboundAt,
    lastInboundAt: r.lastInboundAt,
    status: r.status,
  }));
}
