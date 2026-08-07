/**
 * Tools de SDR conversacional para o agente inbound (handleAgentReply).
 *
 * Portadas da estrutura do agente "Amanda" (agente_minerador_lista, somente
 * leitura) para Node, integradas ao schema do minerador. Adicionam ao agente
 * a qualificacao BANT durante a conversa e a movimentacao no funil.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { leads } from "@/db/schema/leads";
import { outreachThreads } from "@/db/schema/outreach";
import { pipelineStages, activities } from "@/db/schema/pipeline";
import { callBookings } from "@/db/schema/bookings";
import { events } from "@/db/schema/events";
import type { AgentTool } from "@/lib/clients/anthropic";
import { searchKnowledge } from "@/lib/agent/knowledge";

export const SDR_TOOLS: AgentTool[] = [
  {
    name: "qualify_lead",
    description:
      "Registra a qualificacao BANT do lead durante a conversa: calcula score 0 a 5 e temperatura. " +
      "Chame quando ja tiver pelo menos 3 dos 5 sinais (orcamento, autoridade/decisor, necessidade, timing, expectativa).",
    input_schema: {
      type: "object",
      properties: {
        nicho: { type: "string", description: "Nicho ou segmento do lead" },
        dor: { type: "string", description: "Principal dor declarada" },
        budget_sinal: { type: "boolean", description: "Lead tem ou sinaliza orcamento" },
        authority_sinal: { type: "boolean", description: "Lead e o decisor" },
        need_sinal: { type: "boolean", description: "Necessidade clara" },
        timing_sinal: { type: "boolean", description: "Momento/urgencia favoravel" },
        expectativa: { type: "string", description: "Expectativa de resultado declarada" },
      },
      required: ["nicho", "dor"],
    },
  },
  {
    name: "update_crm_stage",
    description:
      "Move o lead para outra etapa do funil. Use 'qualificado' ao qualificar, 'proposta' ao agendar conversa, " +
      "'fechado' se virar cliente, 'perdido' se recusar ou pedir para nao receber mais mensagens.",
    input_schema: {
      type: "object",
      properties: {
        stage: {
          type: "string",
          enum: ["contatado", "qualificado", "proposta", "fechado", "perdido"],
          description: "Etapa alvo do funil",
        },
        reason: { type: "string", description: "Motivo da mudanca (opcional)" },
      },
      required: ["stage"],
    },
  },
  {
    name: "search_knowledge",
    description:
      "Consulta a base de conhecimento do negocio (documentos enviados pelo usuario) para responder com fatos " +
      "reais: precos, servicos, politicas, FAQ. Use SEMPRE que o lead perguntar algo especifico do negocio em vez de inventar.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "O que buscar na base de conhecimento" },
      },
      required: ["query"],
    },
  },
  {
    name: "registrar_opt_out",
    description:
      "Registra opt-out do lead quando ele recusa o contato ou pede para nao receber mais mensagens. " +
      "Marca o lead como nao perturbar e move para perdido no funil. " +
      "Depois de chamar esta tool, despeca-se com educacao e nao insista.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Trecho ou resumo do que o lead disse ao recusar (opcional)",
        },
      },
      required: [],
    },
  },
  {
    name: "notify_human",
    description:
      "Aciona o responsavel humano quando a conversa sai do escopo do agente. " +
      "Use para: STOP (pedido explicito de parar), HOT_LEAD (lead muito quente, pronto p/ fechar), " +
      "OUT_OF_SCOPE (pergunta fora do escopo), AGGRESSIVE (lead agressivo ou abusivo), " +
      "BIG_TICKET (oportunidade de alto valor), TECH_QUESTION (duvida tecnica profunda).",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: ["STOP", "HOT_LEAD", "OUT_OF_SCOPE", "AGGRESSIVE", "BIG_TICKET", "TECH_QUESTION"],
          description: "Motivo do acionamento",
        },
        urgency: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Urgencia: low, medium ou high",
        },
        context: {
          type: "string",
          description: "Resumo do que aconteceu para o humano entender o contexto",
        },
      },
      required: ["reason", "urgency", "context"],
    },
  },
];

function temperaturaFromScore(score: number): "hot" | "warm" | "cold" {
  if (score >= 4) return "hot";
  if (score >= 2) return "warm";
  return "cold";
}

/**
 * Resolve a etapa do funil (pipeline_stages, dinamica por org) a partir de um
 * termo semantico vindo do agente, casando por palavra no nome ou por isWon/isLost.
 */
async function findStage(organizationId: string, target: string) {
  const synonyms: Record<string, string[]> = {
    contatado: ["contatad", "contactad", "contato"],
    qualificado: ["qualificad", "qualified"],
    proposta: ["proposta", "call", "reuniao", "agendad"],
    fechado: ["fechad", "cliente", "ganho", "won"],
    perdido: ["perdid", "lost", "descartad"],
  };
  const key = target.toLowerCase();
  const terms = synonyms[key] ?? [key];

  const stages = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.organizationId, organizationId));

  for (const term of terms) {
    const found = stages.find((s) => s.name.toLowerCase().includes(term));
    if (found) return found;
  }
  if (key === "fechado") return stages.find((s) => s.isWon) ?? null;
  if (key === "perdido") return stages.find((s) => s.isLost) ?? null;
  return null;
}

export async function executeQualifyLead(opts: {
  organizationId: string;
  leadId: string;
  input: Record<string, unknown>;
}): Promise<{ score: number; temperatura: string; should_book_call: boolean }> {
  const i = opts.input;
  const sinais = [
    Boolean(i.budget_sinal),
    Boolean(i.authority_sinal),
    Boolean(i.need_sinal),
    Boolean(i.timing_sinal),
    Boolean(i.expectativa),
  ];
  const score = sinais.filter(Boolean).length;
  const temp = temperaturaFromScore(score);
  const shouldBook = score >= 3;
  const reason = `BANT ${score}/5${i.dor ? `: ${String(i.dor)}` : ""}`;

  await db
    .update(leads)
    .set({
      qualificationStatus: score >= 3 ? "qualified" : "needs_review",
      qualificationScore: score * 20,
      qualificationReason: reason,
      temperature: temp,
      qualifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(leads.id, opts.leadId), eq(leads.organizationId, opts.organizationId)));

  if (score >= 3) {
    const stage = await findStage(opts.organizationId, "qualificado");
    if (stage) {
      await db
        .update(leads)
        .set({ pipelineStageId: stage.id, updatedAt: new Date() })
        .where(and(eq(leads.id, opts.leadId), eq(leads.organizationId, opts.organizationId)));
    }
  }

  await db.insert(activities).values({
    organizationId: opts.organizationId,
    leadId: opts.leadId,
    type: "note",
    title: `Qualificacao BANT: ${score}/5 (${temp})`,
    description: [
      i.nicho ? `Nicho: ${String(i.nicho)}` : "",
      i.dor ? `Dor: ${String(i.dor)}` : "",
      i.expectativa ? `Expectativa: ${String(i.expectativa)}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
  });

  await db.insert(events).values({
    organizationId: opts.organizationId,
    type: "agent.qualified",
    entityType: "lead",
    entityId: opts.leadId,
    data: { score, temperatura: temp, shouldBook },
  });

  return { score, temperatura: temp, should_book_call: shouldBook };
}

export async function executeUpdateStage(opts: {
  organizationId: string;
  leadId: string;
  input: Record<string, unknown>;
}): Promise<{ ok: boolean; stage?: string; error?: string }> {
  const target = String(opts.input.stage ?? "");
  const stage = await findStage(opts.organizationId, target);
  if (!stage) return { ok: false, error: `etapa '${target}' nao encontrada` };

  await db
    .update(leads)
    .set({ pipelineStageId: stage.id, updatedAt: new Date() })
    .where(and(eq(leads.id, opts.leadId), eq(leads.organizationId, opts.organizationId)));

  await db.insert(events).values({
    organizationId: opts.organizationId,
    type: "agent.stage_changed",
    entityType: "lead",
    entityId: opts.leadId,
    data: { stage: stage.name, reason: opts.input.reason ?? null },
  });

  return { ok: true, stage: stage.name };
}

/**
 * Promove o lead no funil quando ele responde (inbound), de forma MONOTONE:
 * move para "Contatado" apenas se ainda estiver sem etapa ou numa etapa anterior.
 * Nunca regride. Inspirado na auto-promocao do agente_minerador_lista.
 */
export async function promoteLeadOnInbound(
  organizationId: string,
  leadId: string,
): Promise<void> {
  const target = await findStage(organizationId, "contatado");
  if (!target) return;

  const [lead] = await db
    .select({ stageId: leads.pipelineStageId })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
    .limit(1);
  if (!lead) return;

  if (lead.stageId) {
    const stages = await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.organizationId, organizationId));
    const current = stages.find((s) => s.id === lead.stageId);
    const tgt = stages.find((s) => s.id === target.id);
    // Nao regride nem mexe em etapas terminais (ganho/perdido).
    if (current && (current.isWon || current.isLost)) return;
    if (current && tgt && current.position >= tgt.position) return;
  }

  await db
    .update(leads)
    .set({ pipelineStageId: target.id, updatedAt: new Date() })
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));
}

export async function executeRegistrarOptOut(opts: {
  organizationId: string;
  leadId: string;
  threadId: string;
  input: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  const reason = String(opts.input.reason ?? "").trim();

  // Marca doNotDisturb e move para perdido
  await db
    .update(leads)
    .set({ doNotDisturb: true, updatedAt: new Date() })
    .where(and(eq(leads.id, opts.leadId), eq(leads.organizationId, opts.organizationId)));

  const stage = await findStage(opts.organizationId, "perdido");
  if (stage) {
    await db
      .update(leads)
      .set({ pipelineStageId: stage.id, updatedAt: new Date() })
      .where(and(eq(leads.id, opts.leadId), eq(leads.organizationId, opts.organizationId)));
  } else {
    console.warn(`[sdr-tools] registrar_opt_out: stage "perdido" nao encontrado para org ${opts.organizationId}`);
  }

  // Pausa o bot na thread para nao reenviar
  await db
    .update(outreachThreads)
    .set({ botPaused: true, status: "dead", updatedAt: new Date() })
    .where(eq(outreachThreads.id, opts.threadId));

  await db.insert(activities).values({
    organizationId: opts.organizationId,
    leadId: opts.leadId,
    type: "note",
    title: "Opt-out registrado pelo agente",
    description: reason || "Lead pediu para nao receber mais mensagens.",
  });

  await db.insert(events).values({
    organizationId: opts.organizationId,
    type: "agent.opt_out",
    entityType: "lead",
    entityId: opts.leadId,
    data: { reason: reason || null, threadId: opts.threadId },
  });

  return { ok: true };
}

export async function executeNotifyHuman(opts: {
  organizationId: string;
  leadId: string;
  threadId: string;
  input: Record<string, unknown>;
}): Promise<{ ok: boolean; error?: string }> {
  const reason = String(opts.input.reason ?? "");
  const urgency = String(opts.input.urgency ?? "medium");
  const context = String(opts.input.context ?? "");

  const validReasons = new Set(["STOP", "HOT_LEAD", "OUT_OF_SCOPE", "AGGRESSIVE", "BIG_TICKET", "TECH_QUESTION"]);
  const validUrgency = new Set(["low", "medium", "high"]);

  if (!validReasons.has(reason)) return { ok: false, error: `reason invalido: ${reason}` };
  if (!validUrgency.has(urgency)) return { ok: false, error: `urgency invalido: ${urgency}` };

  // Pausa o bot e marca thread como precisando de atencao humana
  await db
    .update(outreachThreads)
    .set({ botPaused: true, updatedAt: new Date() })
    .where(eq(outreachThreads.id, opts.threadId));

  await db.insert(activities).values({
    organizationId: opts.organizationId,
    leadId: opts.leadId,
    type: "note",
    title: `Acionamento humano: ${reason} [${urgency}]`,
    description: context,
  });

  await db.insert(events).values({
    organizationId: opts.organizationId,
    type: "agent.notify_human",
    entityType: "thread",
    entityId: opts.threadId,
    data: { reason, urgency, context, leadId: opts.leadId },
  });

  return { ok: true, reason, urgency } as { ok: boolean; reason: string; urgency: string };
}

/**
 * Persiste o agendamento de call apos book_meeting ser executado com sucesso.
 * Replica a logica de book-call/route.ts do agente_minerador_lista:
 *  1. Insere em callBookings (organizationId, leadId, scheduledAt, googleEventId, attendeeEmail, status='scheduled').
 *  2. Move o lead para o stage "proposta" (call agendada) de forma MONOTONE: nunca regride.
 *  3. Registra activity tipo 'meeting' com dueAt = scheduledAt.
 */
export async function persistCallBooking(opts: {
  organizationId: string;
  leadId: string;
  scheduledAt: Date;
  googleEventId?: string | null;
  attendeeEmail?: string | null;
  meetLink?: string | null;
}): Promise<{ bookingId: string }> {
  // 1. Inserir booking
  const [booking] = await db
    .insert(callBookings)
    .values({
      organizationId: opts.organizationId,
      leadId: opts.leadId,
      googleEventId: opts.googleEventId ?? null,
      scheduledAt: opts.scheduledAt,
      attendeeEmail: opts.attendeeEmail ?? null,
      status: "scheduled",
    })
    .returning({ id: callBookings.id });

  const bookingId = booking?.id ?? "unknown";

  // 2. Mover para stage "proposta" (sinonimos incluem "call"/"reuniao"/"agendad")
  //    de forma monotone: nao regride nem move para terminal (won/lost).
  const targetStage = await findStage(opts.organizationId, "proposta");
  if (targetStage) {
    const [lead] = await db
      .select({ stageId: leads.pipelineStageId })
      .from(leads)
      .where(and(eq(leads.id, opts.leadId), eq(leads.organizationId, opts.organizationId)))
      .limit(1);

    let shouldAdvance = true;
    if (lead?.stageId) {
      const stages = await db
        .select()
        .from(pipelineStages)
        .where(eq(pipelineStages.organizationId, opts.organizationId));
      const current = stages.find((s) => s.id === lead.stageId);
      if (current && (current.isWon || current.isLost)) shouldAdvance = false;
      else if (current && current.position >= targetStage.position) shouldAdvance = false;
    }

    if (shouldAdvance) {
      await db
        .update(leads)
        .set({ pipelineStageId: targetStage.id, updatedAt: new Date() })
        .where(and(eq(leads.id, opts.leadId), eq(leads.organizationId, opts.organizationId)));
    }
  }

  // 3. Registrar activity tipo 'meeting'
  const scheduledLabel = opts.scheduledAt.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });
  const descParts = [
    `Call agendada para ${scheduledLabel}.`,
    opts.meetLink ? `Link Meet: ${opts.meetLink}` : "",
    opts.attendeeEmail ? `Email do lead: ${opts.attendeeEmail}` : "",
  ].filter(Boolean);

  await db.insert(activities).values({
    organizationId: opts.organizationId,
    leadId: opts.leadId,
    type: "meeting",
    title: `Call agendada: ${scheduledLabel}`,
    description: descParts.join(" "),
    dueAt: opts.scheduledAt,
  });

  await db.insert(events).values({
    organizationId: opts.organizationId,
    type: "agent.call_booked",
    entityType: "lead",
    entityId: opts.leadId,
    data: {
      bookingId,
      scheduledAt: opts.scheduledAt.toISOString(),
      googleEventId: opts.googleEventId ?? null,
      attendeeEmail: opts.attendeeEmail ?? null,
      meetLink: opts.meetLink ?? null,
    },
  });

  return { bookingId };
}

/** Dispatcher das tools de SDR. Retorna null se a tool nao for de SDR. */
export async function dispatchSdrTool(
  organizationId: string,
  leadId: string,
  toolName: string,
  input: Record<string, unknown>,
  threadId?: string,
): Promise<Record<string, unknown> | null> {
  if (toolName === "qualify_lead") {
    return executeQualifyLead({ organizationId, leadId, input });
  }
  if (toolName === "update_crm_stage") {
    return executeUpdateStage({ organizationId, leadId, input });
  }
  if (toolName === "search_knowledge") {
    const query = String(input.query ?? "");
    const results = await searchKnowledge({ organizationId, query, k: 4 });
    return {
      results,
      found: results.length,
      ...(results.length === 0
        ? { note: "Nenhum resultado na base. Nao invente; ofereca encaminhar para um humano." }
        : {}),
    };
  }
  if (toolName === "registrar_opt_out") {
    return executeRegistrarOptOut({ organizationId, leadId, threadId: threadId ?? "", input });
  }
  if (toolName === "notify_human") {
    return executeNotifyHuman({ organizationId, leadId, threadId: threadId ?? "", input });
  }
  return null;
}
