import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { outreachMessages, outreachQueue, outreachThreads } from "@/db/schema/outreach";

export type DispatchDayRow = {
  dia: string; // 'YYYY-MM-DD' no fuso America/Sao_Paulo
  total: number;
  entregues: number;
  emTransito: number;
  comErro: number;
  pendentes: number;
  erros: Record<string, number>;
};

export type DispatchTodaySummary = DispatchDayRow & {
  finalizado: boolean;
};

// 'YYYY-MM-DD' do dia atual no fuso America/Sao_Paulo (fallback quando nao ha
// nenhuma linha no banco para hoje). en-CA produz o formato ISO ja convertido.
function diaHojeLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Eixo do dia das mensagens outbound no fuso do negocio.
// sentAt registra o momento real do envio; createdAt e o fallback quando o
// status ainda nao foi atualizado pelo handler de send.
const diaExprMsg = sql`date(coalesce(${outreachMessages.sentAt}, ${outreachMessages.createdAt}) at time zone 'America/Sao_Paulo')`;

// Eixo do dia dos itens na fila (pendentes ainda nao confirmados como enviados).
// scheduledAt e NOT NULL no schema, entao nao ha necessidade de fallback.
const diaExprQueue = sql`date(${outreachQueue.scheduledAt} at time zone 'America/Sao_Paulo')`;

// "Hoje" calculado no fuso do negocio para ser compativel com os eixos de dia.
// current_date na Neon/Postgres e avaliado em UTC, entao usamos a expressao
// equivalente ao fuso local.
const hojeLocal = sql`(now() at time zone 'America/Sao_Paulo')::date`;

type DiaAgregado = Omit<DispatchDayRow, "pendentes"> & {
  lastActivity: Date | null;
};

// Agrega mensagens outbound por dia: total, entregues, em transito, com erro e
// ultima atividade (para o calculo de grace period do "finalizado").
// Usa LEFT JOIN com outreachThreads para suportar o filtro de campanha sem
// alterar a estrutura da query quando campaignId nao e fornecido.
async function agregarMensagensPorDia(
  janela: { days: number } | { today: true },
  organizationId: string,
  campaignId?: string,
): Promise<Map<string, DiaAgregado>> {
  const janelaExpr =
    "today" in janela
      ? sql`${diaExprMsg} = ${hojeLocal}`
      : sql`${diaExprMsg} >= ${hojeLocal} - ${janela.days}::int`;

  const where = and(
    eq(outreachMessages.direction, "outbound"),
    eq(outreachMessages.organizationId, organizationId),
    janelaExpr,
    campaignId ? eq(outreachThreads.miningId, campaignId) : undefined,
  );

  const rows = await db
    .select({
      dia: sql<string>`to_char(${diaExprMsg}, 'YYYY-MM-DD')`,
      // Conta apenas mensagens ja despachadas (sent, delivered, failed) para
      // evitar dupla contagem com os itens da outreachQueue (pendentes).
      // Mensagens com status 'pending' ainda nao saiu da fila e sao contadas
      // separadamente por agregarPendentesPorDia.
      total:
        sql<number>`count(*) filter (where ${outreachMessages.status} in ('sent', 'delivered', 'failed'))`.mapWith(
          Number,
        ),
      entregues:
        sql<number>`count(*) filter (where ${outreachMessages.status} = 'delivered')`.mapWith(
          Number,
        ),
      emTransito:
        sql<number>`count(*) filter (where ${outreachMessages.status} = 'sent')`.mapWith(
          Number,
        ),
      comErro:
        sql<number>`count(*) filter (where ${outreachMessages.status} = 'failed')`.mapWith(
          Number,
        ),
      // updatedAt e atualizado tanto no envio quanto na atualizacao de status
      // pelo webhook do Brevo, sendo o melhor proxy de ultima atividade.
      lastActivity: sql<Date | null>`max(${outreachMessages.updatedAt})`,
    })
    .from(outreachMessages)
    .leftJoin(outreachThreads, eq(outreachThreads.id, outreachMessages.threadId))
    .where(where)
    .groupBy(diaExprMsg);

  // Breakdown de erros por dia e por motivo (so mensagens failed com errorReason).
  // Agregado em JS para evitar SQL com GROUP BY em multiplas colunas combinadas.
  const erroRows = await db
    .select({
      dia: sql<string>`to_char(${diaExprMsg}, 'YYYY-MM-DD')`,
      motivo: outreachMessages.errorReason,
      qtd: sql<number>`count(*)`.mapWith(Number),
    })
    .from(outreachMessages)
    .leftJoin(outreachThreads, eq(outreachThreads.id, outreachMessages.threadId))
    .where(
      and(
        where,
        eq(outreachMessages.status, "failed"),
        sql`${outreachMessages.errorReason} is not null`,
      ),
    )
    .groupBy(diaExprMsg, outreachMessages.errorReason);

  const errosByDia = new Map<string, Record<string, number>>();
  for (const e of erroRows) {
    if (!e.motivo) continue;
    const atual = errosByDia.get(e.dia) ?? {};
    atual[e.motivo] = (atual[e.motivo] ?? 0) + e.qtd;
    errosByDia.set(e.dia, atual);
  }

  const map = new Map<string, DiaAgregado>();
  for (const r of rows) {
    map.set(r.dia, {
      dia: r.dia,
      total: r.total,
      entregues: r.entregues,
      emTransito: r.emTransito,
      comErro: r.comErro,
      erros: errosByDia.get(r.dia) ?? {},
      lastActivity: r.lastActivity,
    });
  }
  return map;
}

// Agrega itens pendentes na fila por dia.
// Pendentes = itens com status 'pending' (aguardando processamento) ou
// 'processing' (em transito pelo handler de send, confirmacao ainda nao registrada).
async function agregarPendentesPorDia(
  janela: { days: number } | { today: true },
  organizationId: string,
  campaignId?: string,
): Promise<Map<string, number>> {
  const janelaExpr =
    "today" in janela
      ? sql`${diaExprQueue} = ${hojeLocal}`
      : sql`${diaExprQueue} >= ${hojeLocal} - ${janela.days}::int`;

  const where = and(
    eq(outreachQueue.organizationId, organizationId),
    or(eq(outreachQueue.status, "pending"), eq(outreachQueue.status, "processing")),
    janelaExpr,
    campaignId ? eq(outreachThreads.miningId, campaignId) : undefined,
  );

  const rows = await db
    .select({
      dia: sql<string>`to_char(${diaExprQueue}, 'YYYY-MM-DD')`,
      pendentes: sql<number>`count(*)`.mapWith(Number),
    })
    .from(outreachQueue)
    .leftJoin(outreachThreads, eq(outreachThreads.id, outreachQueue.threadId))
    .where(where)
    .groupBy(diaExprQueue);

  const map = new Map<string, number>();
  for (const r of rows) map.set(r.dia, r.pendentes);
  return map;
}

function montarDia(
  dia: string,
  msg: DiaAgregado | undefined,
  pendentes: number,
): DispatchDayRow {
  return {
    dia,
    total: msg?.total ?? 0,
    entregues: msg?.entregues ?? 0,
    emTransito: msg?.emTransito ?? 0,
    comErro: msg?.comErro ?? 0,
    pendentes,
    erros: msg?.erros ?? {},
  };
}

export async function getDispatchReportByDay(params: {
  organizationId: string;
  days?: number;
  campaignId?: string;
}): Promise<DispatchDayRow[]> {
  const days = params.days && params.days > 0 ? params.days : 14;
  const { organizationId, campaignId } = params;

  const [msgByDia, pendByDia] = await Promise.all([
    agregarMensagensPorDia({ days }, organizationId, campaignId),
    agregarPendentesPorDia({ days }, organizationId, campaignId),
  ]);

  const dias = new Set([...msgByDia.keys(), ...pendByDia.keys()]);
  const lista = [...dias].map((dia) =>
    montarDia(dia, msgByDia.get(dia), pendByDia.get(dia) ?? 0),
  );

  // Mais recente primeiro.
  lista.sort((a, b) => (a.dia < b.dia ? 1 : a.dia > b.dia ? -1 : 0));
  return lista;
}

// Janela de graca de 30 min: um 'sent' so trava o "finalizado" enquanto
// a ultima atividade for recente. Apos esse prazo, confirmamos como finalizado
// mesmo sem callback do Brevo.
const GRACA_MS = 30 * 60 * 1000;

export async function getDispatchTodaySummary(params: {
  organizationId: string;
  campaignId?: string;
}): Promise<DispatchTodaySummary> {
  const { organizationId, campaignId } = params;

  const [msgByDia, pendByDia] = await Promise.all([
    agregarMensagensPorDia({ today: true }, organizationId, campaignId),
    agregarPendentesPorDia({ today: true }, organizationId, campaignId),
  ]);

  const hojeKey = [...msgByDia.keys()][0] ?? [...pendByDia.keys()][0];
  const msg = hojeKey ? msgByDia.get(hojeKey) : undefined;
  const pendentes = hojeKey ? (pendByDia.get(hojeKey) ?? 0) : 0;
  const dia = hojeKey ?? diaHojeLocal();

  const base = montarDia(dia, msg, pendentes);

  // Finalizado quando a fila esta vazia E nao ha 'sent' recente (dentro da graca).
  const semFila = pendentes === 0;
  const ultimaAtividade = msg?.lastActivity ?? null;
  const dentroDaGraca =
    base.emTransito > 0 &&
    ultimaAtividade != null &&
    Date.now() - new Date(ultimaAtividade).getTime() < GRACA_MS;
  const finalizado = semFila && !dentroDaGraca;

  return { ...base, finalizado };
}
