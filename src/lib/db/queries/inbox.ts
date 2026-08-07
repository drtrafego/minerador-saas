import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  outreachThreads,
  outreachMessages,
} from "@/db/schema/outreach";
import { leads } from "@/db/schema/leads";
import { minings as campaigns } from "@/db/schema/minings";
import { activities } from "@/db/schema/pipeline";

export type InboxThreadRow = {
  id: string;
  status: string;
  channel: string;
  currentStep: number;
  botPaused: boolean;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  lastMessageAt: Date | null;
  updatedAt: Date;
  leadId: string;
  leadName: string;
  leadPhone: string | null;
  leadEmail: string | null;
  leadHandle: string | null;
  leadPipelineStageId: string | null;
  campaignId: string | null;
  campaignName: string | null;
  lastMessageBody: string | null;
  lastMessageStatus: string | null;
  lastMessageDirection: string | null;
};

export type ListInboxFilters = {
  filtro?: "nova_msg" | "respondendo" | "todas";
  q?: string;
  stageId?: string;
};

export async function listInboxThreads(
  organizationId: string,
  filters: ListInboxFilters = {},
): Promise<InboxThreadRow[]> {
  const { filtro, q, stageId } = filters;

  const conditions: Parameters<typeof and>[0][] = [
    eq(outreachThreads.organizationId, organizationId),
  ];

  // Aba "respondendo": threads com pelo menos um inbound
  if (filtro === "respondendo") {
    conditions.push(isNotNull(outreachThreads.lastInboundAt));
  }

  // Aba "nova_msg": inbound mais recente que o ultimo outbound (aguardando resposta)
  if (filtro === "nova_msg") {
    conditions.push(isNotNull(outreachThreads.lastInboundAt));
    conditions.push(
      sql`(${outreachThreads.lastOutboundAt} IS NULL OR ${outreachThreads.lastInboundAt} > ${outreachThreads.lastOutboundAt})`,
    );
  }

  // Filtro por etapa do pipeline (no lead)
  if (stageId) {
    conditions.push(eq(leads.pipelineStageId, stageId));
  }

  // Busca por nome ou telefone (ILIKE)
  if (q && q.trim()) {
    const termo = `%${q.trim()}%`;
    conditions.push(
      sql`(${leads.displayName} ilike ${termo} or ${leads.phone} ilike ${termo})`,
    );
  }

  const threads = await db
    .select({
      id: outreachThreads.id,
      status: outreachThreads.status,
      channel: outreachThreads.channel,
      currentStep: outreachThreads.currentStep,
      botPaused: outreachThreads.botPaused,
      lastOutboundAt: outreachThreads.lastOutboundAt,
      lastInboundAt: outreachThreads.lastInboundAt,
      lastMessageAt: outreachThreads.lastMessageAt,
      updatedAt: outreachThreads.updatedAt,
      leadId: outreachThreads.leadId,
      leadName: leads.displayName,
      leadPhone: leads.phone,
      leadEmail: leads.email,
      leadHandle: leads.handle,
      leadPipelineStageId: leads.pipelineStageId,
      campaignId: outreachThreads.miningId,
      campaignName: campaigns.name,
    })
    .from(outreachThreads)
    .innerJoin(leads, eq(leads.id, outreachThreads.leadId))
    .leftJoin(campaigns, eq(campaigns.id, outreachThreads.miningId))
    .where(and(...conditions))
    .orderBy(
      desc(
        sql`coalesce(${outreachThreads.lastInboundAt}, ${outreachThreads.lastOutboundAt}, ${outreachThreads.updatedAt})`,
      ),
    )
    .limit(300);

  if (threads.length === 0) return [];

  const threadIds = threads.map((t) => t.id);
  // IN (lista de uuids) em vez de ANY(::uuid[]): o drizzle interpola um array JS
  // como ($1,$2,...), e (a,b,c)::uuid[] e um cast de tupla invalido no Postgres
  // (gerava erro 500). sql.join monta $1::uuid, $2::uuid, ... corretamente.
  const idsList = sql.join(
    threadIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const lastMessages = await db.execute<{
    thread_id: string;
    body: string;
    status: string;
    direction: string;
  }>(sql`
    SELECT DISTINCT ON (thread_id) thread_id, body, status, direction
    FROM "minerador_scrapling"."outreach_messages"
    WHERE thread_id IN (${idsList})
    ORDER BY thread_id, created_at DESC
  `);

  const byThread = new Map<
    string,
    { body: string; status: string; direction: string }
  >();
  for (const row of lastMessages) {
    byThread.set(row.thread_id, {
      body: row.body,
      status: row.status,
      direction: row.direction,
    });
  }

  return threads.map((t) => {
    const last = byThread.get(t.id);
    return {
      ...t,
      lastMessageBody: last?.body ?? null,
      lastMessageStatus: last?.status ?? null,
      lastMessageDirection: last?.direction ?? null,
    };
  });
}

export type InboxThreadDetail = {
  thread: {
    id: string;
    status: string;
    channel: string;
    currentStep: number;
    createdAt: Date;
    lastOutboundAt: Date | null;
    lastInboundAt: Date | null;
    botPaused: boolean;
  };
  lead: {
    id: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    handle: string | null;
    city: string | null;
    qualificationScore: number | null;
    qualificationReason: string | null;
    temperature: string | null;
  };
  campaign: {
    id: string;
    name: string;
  } | null;
  messages: Array<{
    id: string;
    direction: string;
    status: string;
    step: number;
    subject: string | null;
    body: string;
    errorReason: string | null;
    sentAt: Date | null;
    createdAt: Date;
    metadata: Record<string, unknown> | null;
  }>;
  activities: Array<{
    id: string;
    type: string;
    title: string;
    description: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }>;
};

export async function getInboxThread(
  organizationId: string,
  threadId: string,
): Promise<InboxThreadDetail | null> {
  const rows = await db
    .select({
      thread: outreachThreads,
      lead: leads,
      campaign: campaigns,
    })
    .from(outreachThreads)
    .innerJoin(leads, eq(leads.id, outreachThreads.leadId))
    .leftJoin(campaigns, eq(campaigns.id, outreachThreads.miningId))
    .where(
      and(
        eq(outreachThreads.id, threadId),
        eq(outreachThreads.organizationId, organizationId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const [messages, leadActivities] = await Promise.all([
    db
      .select({
        id: outreachMessages.id,
        direction: outreachMessages.direction,
        status: outreachMessages.status,
        step: outreachMessages.step,
        subject: outreachMessages.subject,
        body: outreachMessages.body,
        errorReason: outreachMessages.errorReason,
        sentAt: outreachMessages.sentAt,
        createdAt: outreachMessages.createdAt,
        metadata: outreachMessages.metadata,
      })
      .from(outreachMessages)
      .where(
        and(
          eq(outreachMessages.threadId, threadId),
          eq(outreachMessages.organizationId, organizationId),
        ),
      )
      .orderBy(asc(outreachMessages.createdAt)),

    db
      .select({
        id: activities.id,
        type: activities.type,
        title: activities.title,
        description: activities.description,
        createdAt: activities.createdAt,
        completedAt: activities.completedAt,
      })
      .from(activities)
      .where(
        and(
          eq(activities.leadId, row.lead.id),
          eq(activities.organizationId, organizationId),
        ),
      )
      .orderBy(desc(activities.createdAt))
      .limit(10),
  ]);

  return {
    thread: {
      id: row.thread.id,
      status: row.thread.status,
      channel: row.thread.channel,
      currentStep: row.thread.currentStep,
      createdAt: row.thread.createdAt,
      lastOutboundAt: row.thread.lastOutboundAt,
      lastInboundAt: row.thread.lastInboundAt,
      botPaused: row.thread.botPaused,
    },
    lead: {
      id: row.lead.id,
      displayName: row.lead.displayName,
      email: row.lead.email,
      phone: row.lead.phone,
      website: row.lead.website,
      handle: row.lead.handle,
      city: row.lead.city,
      qualificationScore: row.lead.qualificationScore,
      qualificationReason: row.lead.qualificationReason,
      temperature: row.lead.temperature,
    },
    campaign: row.campaign
      ? { id: row.campaign.id, name: row.campaign.name }
      : null,
    messages,
    activities: leadActivities,
  };
}

/**
 * Contagem real (banco) de threads com pelo menos uma mensagem inbound,
 * respeitando os mesmos filtros opcionais de q e stageId.
 * Usado para exibir o contador correto na aba "Respondendo" sem depender
 * do limite de 300 linhas da listagem.
 */
export async function countInboxRespondendo(
  organizationId: string,
  filters: Pick<ListInboxFilters, "q" | "stageId"> = {},
): Promise<number> {
  const { q, stageId } = filters;

  const conditions: Parameters<typeof and>[0][] = [
    eq(outreachThreads.organizationId, organizationId),
    isNotNull(outreachThreads.lastInboundAt),
  ];

  if (stageId) {
    conditions.push(eq(leads.pipelineStageId, stageId));
  }

  if (q && q.trim()) {
    const termo = `%${q.trim()}%`;
    conditions.push(
      sql`(${leads.displayName} ilike ${termo} or ${leads.phone} ilike ${termo})`,
    );
  }

  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(outreachThreads)
    .innerJoin(leads, eq(leads.id, outreachThreads.leadId))
    .where(and(...conditions));

  return row?.c ?? 0;
}

/**
 * Contagem real de threads onde o lead respondeu e ainda nao recebeu resposta
 * (lastInboundAt > lastOutboundAt ou lastOutboundAt e nulo).
 * Derivado dos campos existentes, sem nova coluna.
 */
export async function countInboxNovaMsg(
  organizationId: string,
  filters: Pick<ListInboxFilters, "q" | "stageId"> = {},
): Promise<number> {
  const { q, stageId } = filters;

  const conditions: Parameters<typeof and>[0][] = [
    eq(outreachThreads.organizationId, organizationId),
    isNotNull(outreachThreads.lastInboundAt),
    sql`(${outreachThreads.lastOutboundAt} IS NULL OR ${outreachThreads.lastInboundAt} > ${outreachThreads.lastOutboundAt})`,
  ];

  if (stageId) {
    conditions.push(eq(leads.pipelineStageId, stageId));
  }

  if (q && q.trim()) {
    const termo = `%${q.trim()}%`;
    conditions.push(
      sql`(${leads.displayName} ilike ${termo} or ${leads.phone} ilike ${termo})`,
    );
  }

  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(outreachThreads)
    .innerJoin(leads, eq(leads.id, outreachThreads.leadId))
    .where(and(...conditions));

  return row?.c ?? 0;
}

export async function getOutreachStatusByLead(
  organizationId: string,
  leadIds: string[],
): Promise<Map<string, { id: string; status: string }>> {
  const map = new Map<string, { id: string; status: string }>();
  if (leadIds.length === 0) return map;

  const rows = await db
    .select({
      id: outreachThreads.id,
      leadId: outreachThreads.leadId,
      status: outreachThreads.status,
      updatedAt: outreachThreads.updatedAt,
    })
    .from(outreachThreads)
    .where(
      and(
        eq(outreachThreads.organizationId, organizationId),
        inArray(outreachThreads.leadId, leadIds),
      ),
    )
    .orderBy(desc(outreachThreads.updatedAt));

  for (const row of rows) {
    if (!map.has(row.leadId)) {
      map.set(row.leadId, { id: row.id, status: row.status });
    }
  }
  return map;
}
