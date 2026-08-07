import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { minings, miningSources } from "@/db/schema/minings";
import { leads } from "@/db/schema/leads";
import { scrapingJobs } from "@/db/schema/jobs";

export type MiningListItem = {
  id: string;
  name: string;
  niche: string | null;
  status: "draft" | "active" | "paused" | "archived";
  createdAt: Date;
  totalLeads: number;
  qualifiedLeads: number;
  disqualifiedLeads: number;
  pendingLeads: number;
  primarySource: string | null;
};

export async function listMinings(
  organizationId: string,
): Promise<MiningListItem[]> {
  const rows = await db
    .select({
      id: minings.id,
      name: minings.name,
      niche: minings.niche,
      status: minings.status,
      createdAt: minings.createdAt,
      totalLeads: sql<number>`coalesce(count(${leads.id}), 0)::int`,
      qualifiedLeads: sql<number>`coalesce(sum(case when ${leads.qualificationStatus} = 'qualified' then 1 else 0 end), 0)::int`,
      disqualifiedLeads: sql<number>`coalesce(sum(case when ${leads.qualificationStatus} = 'disqualified' then 1 else 0 end), 0)::int`,
      pendingLeads: sql<number>`coalesce(sum(case when ${leads.qualificationStatus} = 'pending' then 1 else 0 end), 0)::int`,
    })
    .from(minings)
    .leftJoin(leads, eq(leads.miningId, minings.id))
    .where(eq(minings.organizationId, organizationId))
    .groupBy(minings.id)
    .orderBy(desc(minings.createdAt));

  const sourceRows = await db
    .select({
      miningId: miningSources.miningId,
      type: miningSources.type,
    })
    .from(miningSources)
    .where(eq(miningSources.organizationId, organizationId));

  const sourceByMining = new Map<string, string>();
  for (const s of sourceRows) {
    if (!sourceByMining.has(s.miningId)) {
      sourceByMining.set(s.miningId, s.type);
    }
  }

  return rows.map((r) => ({
    ...r,
    primarySource: sourceByMining.get(r.id) ?? null,
  }));
}

// Nichos distintos das mineracoes da org, para o filtro da tela de leads.
export async function listNiches(organizationId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ niche: minings.niche })
    .from(minings)
    .where(eq(minings.organizationId, organizationId));
  return rows
    .map((r) => r.niche)
    .filter((n): n is string => !!n && n.trim().length > 0)
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export async function getMiningById(
  organizationId: string,
  miningId: string,
) {
  const rows = await db
    .select()
    .from(minings)
    .where(
      and(
        eq(minings.id, miningId),
        eq(minings.organizationId, organizationId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getMiningSources(
  organizationId: string,
  miningId: string,
) {
  return db
    .select()
    .from(miningSources)
    .where(
      and(
        eq(miningSources.miningId, miningId),
        eq(miningSources.organizationId, organizationId),
      ),
    );
}

export async function getMiningScrapingJobs(
  organizationId: string,
  miningId: string,
) {
  return db
    .select()
    .from(scrapingJobs)
    .where(
      and(
        eq(scrapingJobs.miningId, miningId),
        eq(scrapingJobs.organizationId, organizationId),
      ),
    )
    .orderBy(desc(scrapingJobs.createdAt))
    .limit(20);
}

export async function getMiningCounters(
  organizationId: string,
  miningId: string,
) {
  const rows = await db
    .select({
      total: sql<number>`coalesce(count(*), 0)::int`,
      qualified: sql<number>`coalesce(sum(case when ${leads.qualificationStatus} = 'qualified' then 1 else 0 end), 0)::int`,
      disqualified: sql<number>`coalesce(sum(case when ${leads.qualificationStatus} = 'disqualified' then 1 else 0 end), 0)::int`,
      pending: sql<number>`coalesce(sum(case when ${leads.qualificationStatus} = 'pending' then 1 else 0 end), 0)::int`,
    })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        eq(leads.miningId, miningId),
      ),
    );

  return rows[0] ?? { total: 0, qualified: 0, disqualified: 0, pending: 0 };
}
