import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, isNotNull, not, exists, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads, type leadQualificationStatusEnum } from "@/db/schema/leads";
import { minings } from "@/db/schema/minings";
import { outreachThreads } from "@/db/schema/outreach";

type Status = (typeof leadQualificationStatusEnum.enumValues)[number];

export type OutreachChannel = "whatsapp" | "email" | "instagram_dm" | "linkedin_dm";

export type LeadRow = typeof leads.$inferSelect & {
  campaignName: string | null;
  niche: string | null;
};

export async function listLeads(opts: {
  organizationId: string;
  campaignId?: string;
  status?: Status | "all";
  q?: string;
  naoAbordadosCanal?: OutreachChannel;
  /** Filtra por origem do lead: google_places, linkedin, instagram, manual. */
  source?: string;
  /** Filtra pelo nicho da mineracao (ex: medico, advogado, restaurante). */
  niche?: string;
  /** Quando true, retorna apenas leads que ja responderam (lastInboundAt preenchido em alguma thread). */
  responderam?: boolean;
  /** Filtra por canal de contato DISPONIVEL (para saber quem da para abordar por email/WhatsApp). */
  hasEmail?: boolean;
  hasPhone?: boolean;
  /** Ordenacao da tabela (cabecalhos clicaveis). */
  sort?: "name" | "score" | "campaign" | "created";
  dir?: "asc" | "desc";
  limit?: number;
  page?: number;
}): Promise<{ rows: LeadRow[]; total: number }> {
  const pageSize = opts.limit ?? 150;
  const page = opts.page && opts.page > 0 ? opts.page : 1;
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [
    eq(leads.organizationId, opts.organizationId),
    isNull(leads.deletedAt),
  ];

  if (opts.campaignId) {
    conditions.push(eq(leads.miningId, opts.campaignId));
  }
  if (opts.status && opts.status !== "all") {
    conditions.push(eq(leads.qualificationStatus, opts.status));
  }
  if (opts.hasEmail) {
    conditions.push(sql`${leads.email} is not null and ${leads.email} <> ''`);
  }
  if (opts.hasPhone) {
    conditions.push(sql`${leads.phone} is not null and ${leads.phone} <> ''`);
  }
  if (opts.source) {
    conditions.push(
      eq(leads.source, opts.source as (typeof leads.source.enumValues)[number]),
    );
  }
  if (opts.niche) {
    conditions.push(eq(minings.niche, opts.niche));
  }
  if (opts.q) {
    const term = `%${opts.q}%`;
    conditions.push(
      or(
        ilike(leads.displayName, term),
        ilike(leads.email, term),
        ilike(leads.phone, term),
        ilike(leads.company, term),
      ) as SQL,
    );
  }
  if (opts.responderam) {
    // Apenas leads com pelo menos uma thread que recebeu mensagem inbound
    conditions.push(
      exists(
        db
          .select({ _: outreachThreads.id })
          .from(outreachThreads)
          .where(
            and(
              eq(outreachThreads.organizationId, opts.organizationId),
              eq(outreachThreads.leadId, leads.id),
              isNull(outreachThreads.deletedAt),
              isNotNull(outreachThreads.lastInboundAt),
            ),
          ),
      ) as SQL,
    );
  }

  if (opts.naoAbordadosCanal) {
    // Lead e "nao abordado" quando nao existe thread com lastOutboundAt preenchido
    // naquele canal para esta org. Reusa outreach_threads que ja possui o indice.
    conditions.push(
      not(
        exists(
          db
            .select({ _: outreachThreads.id })
            .from(outreachThreads)
            .where(
              and(
                eq(outreachThreads.organizationId, opts.organizationId),
                eq(outreachThreads.leadId, leads.id),
                eq(outreachThreads.channel, opts.naoAbordadosCanal),
                isNull(outreachThreads.deletedAt),
                not(isNull(outreachThreads.lastOutboundAt)),
              ),
            ),
        ),
      ),
    );
  }

  const where = and(...conditions);

  // Ordenacao por cabecalho clicavel. Default: mais recentes primeiro.
  const dirFn = opts.dir === "asc" ? asc : desc;
  const sortCol =
    opts.sort === "name"
      ? leads.displayName
      : opts.sort === "score"
        ? leads.qualificationScore
        : opts.sort === "campaign"
          ? minings.name
          : leads.createdAt;
  const orderBy = opts.sort ? dirFn(sortCol) : desc(leads.createdAt);

  const [totalRow, rows] = await Promise.all([
    db.select({ c: count() }).from(leads).leftJoin(minings, eq(leads.miningId, minings.id)).where(where),
    db
      .select({
        lead: leads,
        campaignName: minings.name,
        niche: minings.niche,
      })
      .from(leads)
      .leftJoin(minings, eq(leads.miningId, minings.id))
      .where(where)
      .orderBy(orderBy)
      .limit(pageSize)
      .offset(offset),
  ]);

  return {
    total: totalRow[0]?.c ?? 0,
    rows: rows.map((r) => ({ ...r.lead, campaignName: r.campaignName, niche: r.niche })),
  };
}

export async function getLead(opts: {
  organizationId: string;
  leadId: string;
}): Promise<LeadRow | null> {
  const rows = await db
    .select({
      lead: leads,
      campaignName: minings.name,
      niche: minings.niche,
    })
    .from(leads)
    .leftJoin(minings, eq(leads.miningId, minings.id))
    .where(and(eq(leads.organizationId, opts.organizationId), eq(leads.id, opts.leadId)))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...r.lead, campaignName: r.campaignName, niche: r.niche };
}
