import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads } from "@/db/schema/leads";
import { minings } from "@/db/schema/minings";
import { outreachThreads } from "@/db/schema/outreach";
import { activities, pipelineStages, DEFAULT_PIPELINE_STAGES } from "@/db/schema/pipeline";

type OutreachChannelName = "whatsapp" | "email" | "instagram_dm" | "linkedin_dm";

export type PipelineStageRow = typeof pipelineStages.$inferSelect;
export type ActivityRow = typeof activities.$inferSelect;

export async function ensureDefaultPipeline(organizationId: string): Promise<PipelineStageRow[]> {
  const existing = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.organizationId, organizationId))
    .orderBy(asc(pipelineStages.position));

  if (existing.length > 0) return existing;

  const rows = DEFAULT_PIPELINE_STAGES.map((s) => ({
    organizationId,
    name: s.name,
    color: s.color,
    position: s.position,
    isWon: Boolean(s.isWon),
    isLost: Boolean(s.isLost),
  }));

  const inserted = await db.insert(pipelineStages).values(rows).returning();
  return inserted.sort((a, b) => a.position - b.position);
}

export async function listPipelineStages(organizationId: string): Promise<PipelineStageRow[]> {
  return ensureDefaultPipeline(organizationId);
}

export type LeadChannelOutreach = {
  channel: OutreachChannelName;
  abordado: boolean;
  respondido: boolean;
};

export type PipelineLeadCard = {
  id: string;
  displayName: string;
  company: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  temperature: "cold" | "warm" | "hot" | null;
  qualificationScore: number | null;
  pipelineStageId: string | null;
  campaignName: string | null;
  source: string;
  handle: string | null;
  updatedAt: Date;
  channelOutreach: LeadChannelOutreach[];
};

export type PipelineKpis = {
  total: number;
  abordados: number;
  respostas: number;
  taxaResposta: number;
};

/** KPIs do funil: total de leads no pipeline, abordados e respostas (via outreach). */
export async function getPipelineKpis(organizationId: string): Promise<PipelineKpis> {
  const [leadCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        isNull(leads.deletedAt),
        or(
          eq(leads.qualificationStatus, "qualified"),
          eq(leads.qualificationStatus, "needs_review"),
        ),
      ),
    );

  const [abordadosRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(outreachThreads)
    .where(
      and(
        eq(outreachThreads.organizationId, organizationId),
        isNull(outreachThreads.deletedAt),
        sql`${outreachThreads.lastOutboundAt} is not null`,
      ),
    );

  const [respostasRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(outreachThreads)
    .where(
      and(
        eq(outreachThreads.organizationId, organizationId),
        isNull(outreachThreads.deletedAt),
        sql`${outreachThreads.lastInboundAt} is not null`,
      ),
    );

  const total = leadCount?.c ?? 0;
  const abordados = abordadosRow?.c ?? 0;
  const respostas = respostasRow?.c ?? 0;
  const taxaResposta = abordados > 0 ? Math.round((respostas / abordados) * 100) : 0;

  return { total, abordados, respostas, taxaResposta };
}

const ALL_CHANNELS: OutreachChannelName[] = ["whatsapp", "email", "instagram_dm", "linkedin_dm"];

export async function listPipelineLeads(organizationId: string): Promise<PipelineLeadCard[]> {
  const rows = await db
    .select({
      id: leads.id,
      displayName: leads.displayName,
      company: leads.company,
      city: leads.city,
      phone: leads.phone,
      email: leads.email,
      temperature: leads.temperature,
      qualificationScore: leads.qualificationScore,
      pipelineStageId: leads.pipelineStageId,
      source: leads.source,
      handle: leads.handle,
      updatedAt: leads.updatedAt,
      campaignName: minings.name,
    })
    .from(leads)
    .leftJoin(minings, eq(leads.miningId, minings.id))
    .where(
      and(
        eq(leads.organizationId, organizationId),
        isNull(leads.deletedAt),
        or(
          eq(leads.qualificationStatus, "qualified"),
          eq(leads.qualificationStatus, "needs_review"),
        ),
      ),
    )
    .orderBy(desc(leads.updatedAt))
    .limit(500);

  if (rows.length === 0) return [];

  // Busca canais abordados/respondidos somente para os leads da pagina atual
  const leadIds = rows.map((r) => r.id);
  const threadRows = await db
    .select({
      leadId: outreachThreads.leadId,
      channel: outreachThreads.channel,
      lastOutboundAt: outreachThreads.lastOutboundAt,
      lastInboundAt: outreachThreads.lastInboundAt,
    })
    .from(outreachThreads)
    .where(
      and(
        eq(outreachThreads.organizationId, organizationId),
        isNull(outreachThreads.deletedAt),
        inArray(outreachThreads.leadId, leadIds),
      ),
    );

  // Agrupa por leadId -> canal
  type ChannelData = { lastOutboundAt: Date | null; lastInboundAt: Date | null };
  const threadMap = new Map<string, Map<OutreachChannelName, ChannelData>>();

  for (const tr of threadRows) {
    const ch = tr.channel as OutreachChannelName;
    if (!threadMap.has(tr.leadId)) {
      threadMap.set(tr.leadId, new Map());
    }
    const chanMap = threadMap.get(tr.leadId)!;
    const existing = chanMap.get(ch);
    if (!existing) {
      chanMap.set(ch, { lastOutboundAt: tr.lastOutboundAt, lastInboundAt: tr.lastInboundAt });
    } else {
      chanMap.set(ch, {
        lastOutboundAt:
          tr.lastOutboundAt && (!existing.lastOutboundAt || tr.lastOutboundAt > existing.lastOutboundAt)
            ? tr.lastOutboundAt
            : existing.lastOutboundAt,
        lastInboundAt:
          tr.lastInboundAt && (!existing.lastInboundAt || tr.lastInboundAt > existing.lastInboundAt)
            ? tr.lastInboundAt
            : existing.lastInboundAt,
      });
    }
  }

  return rows.map((row) => {
    const chanMap = threadMap.get(row.id);
    const channelOutreach: LeadChannelOutreach[] = ALL_CHANNELS.map((ch) => {
      const data = chanMap?.get(ch);
      return {
        channel: ch,
        abordado: data?.lastOutboundAt != null,
        respondido: data?.lastInboundAt != null,
      };
    });
    return { ...row, channelOutreach } as PipelineLeadCard;
  });
}

export async function listLeadActivities(leadId: string, organizationId: string): Promise<ActivityRow[]> {
  return db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.leadId, leadId),
        eq(activities.organizationId, organizationId),
      ),
    )
    .orderBy(desc(activities.createdAt))
    .limit(200);
}
