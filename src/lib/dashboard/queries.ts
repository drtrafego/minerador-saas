import "server-only";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { minings } from "@/db/schema/minings";
import { leads } from "@/db/schema/leads";
import {
  outreachThreads,
  outreachMessages,
} from "@/db/schema/outreach";
import { sendCounters } from "@/db/schema/jobs";

type BaseParams = {
  organizationId: string;
  campaignId?: string;
  windowDays?: number;
};

function windowStart(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export type FunnelMetrics = {
  leadsTotal: number;
  leadsQualified: number;
  leadsContacted: number;
  leadsReplied: number;
  leadsBooked: number;
};

export async function getFunnelMetrics(
  params: BaseParams,
): Promise<FunnelMetrics> {
  const { organizationId, campaignId, windowDays = 30 } = params;
  const since = windowStart(windowDays);
  const sinceIso = since.toISOString();

  const campaignFilter = campaignId
    ? sql`AND l.mining_id = ${campaignId}::uuid`
    : sql``;
  const campaignFilterThreads = campaignId
    ? sql`AND t.mining_id = ${campaignId}::uuid`
    : sql``;

  const leadsRows = await db.execute<{
    total: string;
    qualified: string;
  }>(sql`
    SELECT
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE l.qualification_status = 'qualified')::text AS qualified
    FROM "minerador_scrapling"."leads" l
    WHERE l.organization_id = ${organizationId}
      AND l.created_at >= ${sinceIso}::timestamptz
      ${campaignFilter}
  `);

  const threadsRows = await db.execute<{
    contacted: string;
    replied: string;
    booked: string;
  }>(sql`
    SELECT
      COUNT(DISTINCT t.lead_id) FILTER (WHERE t.last_outbound_at IS NOT NULL)::text AS contacted,
      COUNT(DISTINCT t.lead_id) FILTER (WHERE t.status IN ('replied','booked'))::text AS replied,
      COUNT(DISTINCT t.lead_id) FILTER (WHERE t.status = 'booked')::text AS booked
    FROM "minerador_scrapling"."outreach_threads" t
    WHERE t.organization_id = ${organizationId}
      AND t.created_at >= ${sinceIso}::timestamptz
      ${campaignFilterThreads}
  `);

  const l = leadsRows[0];
  const t = threadsRows[0];

  return {
    leadsTotal: Number(l?.total ?? 0),
    leadsQualified: Number(l?.qualified ?? 0),
    leadsContacted: Number(t?.contacted ?? 0),
    leadsReplied: Number(t?.replied ?? 0),
    leadsBooked: Number(t?.booked ?? 0),
  };
}

export type ThreadsByStatusItem = {
  status: string;
  count: number;
};

export async function getThreadsByStatus(
  params: BaseParams,
): Promise<ThreadsByStatusItem[]> {
  const { organizationId, campaignId, windowDays = 30 } = params;
  const since = windowStart(windowDays);

  const where = campaignId
    ? and(
        eq(outreachThreads.organizationId, organizationId),
        eq(outreachThreads.miningId, campaignId),
        gte(outreachThreads.createdAt, since),
      )
    : and(
        eq(outreachThreads.organizationId, organizationId),
        gte(outreachThreads.createdAt, since),
      );

  const rows = await db
    .select({
      status: outreachThreads.status,
      count: sql<number>`count(*)::int`,
    })
    .from(outreachThreads)
    .where(where)
    .groupBy(outreachThreads.status);

  return rows.map((r) => ({ status: r.status, count: r.count }));
}

export type MessagesStats = {
  sent: number;
  failed: number;
  pending: number;
};

export async function getMessagesStats(
  params: BaseParams,
): Promise<MessagesStats> {
  const { organizationId, campaignId, windowDays = 30 } = params;
  const sinceIso = windowStart(windowDays).toISOString();

  const campaignFilter = campaignId
    ? sql`AND t.mining_id = ${campaignId}::uuid`
    : sql``;

  const rows = await db.execute<{
    sent: string;
    failed: string;
    pending: string;
  }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE m.status = 'sent')::text AS sent,
      COUNT(*) FILTER (WHERE m.status = 'failed')::text AS failed,
      COUNT(*) FILTER (WHERE m.status = 'pending')::text AS pending
    FROM "minerador_scrapling"."outreach_messages" m
    JOIN "minerador_scrapling"."outreach_threads" t ON t.id = m.thread_id
    WHERE m.organization_id = ${organizationId}
      AND m.created_at >= ${sinceIso}::timestamptz
      ${campaignFilter}
  `);

  const r = rows[0];
  return {
    sent: Number(r?.sent ?? 0),
    failed: Number(r?.failed ?? 0),
    pending: Number(r?.pending ?? 0),
  };
}

export type SendsPerDayItem = {
  day: string;
  count: number;
};

export async function getSendsPerDay(
  params: BaseParams,
): Promise<SendsPerDayItem[]> {
  const { organizationId, campaignId } = params;

  const baseWhere = campaignId
    ? and(
        eq(sendCounters.organizationId, organizationId),
        eq(sendCounters.campaignId, campaignId),
        sql`${sendCounters.bucket} LIKE 'd:%'`,
      )
    : and(
        eq(sendCounters.organizationId, organizationId),
        sql`${sendCounters.bucket} LIKE 'd:%'`,
      );

  const rows = await db
    .select({
      bucket: sendCounters.bucket,
      count: sql<number>`coalesce(sum(${sendCounters.count}), 0)::int`,
    })
    .from(sendCounters)
    .where(baseWhere)
    .groupBy(sendCounters.bucket);

  const map = new Map<string, number>();
  for (const r of rows) {
    const day = r.bucket.slice(2);
    if (!day) continue;
    map.set(day, (map.get(day) ?? 0) + r.count);
  }

  const result: SendsPerDayItem[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const key = `${y}-${m}-${dd}`;
    result.push({ day: key, count: map.get(key) ?? 0 });
  }
  return result;
}

export type ActiveCampaignItem = {
  id: string;
  name: string;
  niche: string | null;
  totalLeads: number;
  contactedLeads: number;
  repliedLeads: number;
};

export async function getActiveCampaigns(params: {
  organizationId: string;
  windowDays?: number;
  limit?: number;
}): Promise<ActiveCampaignItem[]> {
  const { organizationId, windowDays = 30, limit = 5 } = params;
  const since = windowStart(windowDays);
  const sinceIso = since.toISOString();

  const leadCounts = await db
    .select({
      miningId: leads.miningId,
      total: sql<number>`count(*)::int`,
    })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        gte(leads.createdAt, since),
      ),
    )
    .groupBy(leads.miningId);

  const threadRows = await db.execute<{
    mining_id: string | null;
    contacted: string;
    replied: string;
  }>(sql`
    SELECT
      t.mining_id,
      COUNT(DISTINCT t.lead_id) FILTER (WHERE t.last_outbound_at IS NOT NULL)::text AS contacted,
      COUNT(DISTINCT t.lead_id) FILTER (WHERE t.status IN ('replied','booked'))::text AS replied
    FROM "minerador_scrapling"."outreach_threads" t
    WHERE t.organization_id = ${organizationId}
      AND t.created_at >= ${sinceIso}::timestamptz
    GROUP BY t.mining_id
  `);

  const leadMap = new Map<string, number>();
  for (const r of leadCounts) {
    if (r.miningId) leadMap.set(r.miningId, r.total);
  }
  const threadMap = new Map<
    string,
    { contacted: number; replied: number }
  >();
  for (const r of threadRows) {
    if (r.mining_id) {
      threadMap.set(r.mining_id, {
        contacted: Number(r.contacted ?? 0),
        replied: Number(r.replied ?? 0),
      });
    }
  }

  const campaignRows = await db
    .select({
      id: minings.id,
      name: minings.name,
      niche: minings.niche,
      status: minings.status,
      createdAt: minings.createdAt,
    })
    .from(minings)
    .where(
      and(
        eq(minings.organizationId, organizationId),
        eq(minings.status, "active"),
      ),
    )
    .orderBy(desc(minings.createdAt));

  const enriched: ActiveCampaignItem[] = campaignRows.map((c) => {
    const t = threadMap.get(c.id) ?? { contacted: 0, replied: 0 };
    return {
      id: c.id,
      name: c.name,
      niche: c.niche,
      totalLeads: leadMap.get(c.id) ?? 0,
      contactedLeads: t.contacted,
      repliedLeads: t.replied,
    };
  });

  enriched.sort((a, b) => b.totalLeads - a.totalLeads);
  return enriched.slice(0, limit);
}
