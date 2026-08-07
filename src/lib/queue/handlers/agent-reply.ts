import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { agentConfigs } from "@/db/schema/agent";
import { minings as campaigns } from "@/db/schema/minings";
import { leads as leadsTable } from "@/db/schema/leads";
import {
  outreachMessages,
  outreachThreads,
} from "@/db/schema/outreach";
import { events } from "@/db/schema/events";
import {
  generateAgentReply,
  serializeToolUses,
  serializeToolResults,
  type AgentMessage,
  type AgentTool,
} from "@/lib/clients/anthropic";
import {
  checkCalendarAvailability,
  createCalendarEvent,
  scanCalendarSlots,
} from "@/lib/clients/google-calendar";
import { getOrgCredential, MissingCredentialError } from "@/lib/credentials/get";
import {
  loadWhatsAppAPICredential,
  sendWhatsAppAPIMessage,
  WhatsAppAPIError,
  WhatsAppAPINotConfiguredError,
} from "@/lib/clients/whatsapp-api";
import {
  loadUazAPICredential,
  sendUazAPIMessage,
  UazAPIError,
  UazAPINotConfiguredError,
} from "@/lib/clients/whatsapp-uazapi";
import type { AgentReplyPayload } from "@/lib/queue/types";
import { SDR_TOOLS, dispatchSdrTool, promoteLeadOnInbound, persistCallBooking } from "@/lib/agent/sdr-tools";
import {
  sendBrevoEmail,
  BrevoNotConfiguredError,
} from "@/lib/clients/brevo";

// Reduzido de 20 para 12: economiza tokens sem perder contexto relevante da conversa.
const HISTORY_LIMIT = 12;

// ---- Regra de estilo: varia por canal, SEMPRE anexada mesmo com override ----
function buildEstiloResposta(channel: string): string {
  if (channel === "email") {
    return `

## Estilo das respostas por e-mail (regra de ouro, acima de qualquer outra instrucao)
Voce esta conversando por E-MAIL, nao por WhatsApp. O ritmo aqui e diferente: a pessoa le no tempo dela e responde devagar. Por isso cada e-mail seu precisa AVANCAR a conversa de verdade, nunca arrastar com troca solta.
- Seja mais completa que no WhatsApp, mas sem virar parede de texto. Poucos paragrafos curtos: uma saudacao breve, o ponto com um pouco de contexto, e um proximo passo claro.
- Antecipe a duvida obvia. Se a pessoa demonstrou interesse, ja adiante de leve como funciona, em vez de fazer ela perguntar de novo.
- Uma mensagem, um avanco. Faca no maximo uma ou duas perguntas essenciais num e-mail so. NUNCA mande lista numerada de perguntas nem questionario com varias perguntas.
- Assim que tiver o basico do negocio, NAO continue qualificando por e-mail: avance para a call. Proponha voce mesma dois ou tres horarios concretos e use a ferramenta de agendamento para marcar e enviar o link da call.
- Mire fechar em duas ou tres trocas, nao mais. Cada resposta deve aproximar do agendamento, nunca so manter o papo.
- Tom humano, caloroso e direto, como uma pessoa real escrevendo. Nada de linguagem robotica nem jargao de agencia.
- Escreva sempre em portugues com acentuacao completa. Nunca use travessao nem hifen como separador, so virgula, ponto ou dois-pontos.
- Assine com seu primeiro nome no fim de cada e-mail (assinatura curta, ex: "Abraco, [seu primeiro nome]").`;
  }
  return `

## Estilo das respostas (regra de ouro, acima de qualquer outra instrucao)
Voce conversa pelo WhatsApp. Escreva como uma pessoa real digitando no celular, nunca como um texto formal ou e-mail.
- No maximo 2 ou 3 frases curtas por mensagem. Jamais mande parede de texto.
- Um ponto por vez. Se o lead trouxer varias duvidas ou objecoes, responda a mais importante de forma curta e faca uma pergunta, em vez de despejar toda a argumentacao de uma vez.
- Nada de listas longas nem varios paragrafos numa mensagem so.
- Seja direta, calorosa e humana. No WhatsApp, mensagem curta converte mais que explicacao longa.
- Nunca use travessao nem hifen como separador. Use apenas virgula, ponto ou dois-pontos.`;
}

const CALENDAR_TOOLS: AgentTool[] = [
  {
    name: "check_availability",
    description:
      "Verifica horarios livres na agenda. " +
      "SEM 'date': retorna os 3 proximos slots disponiveis nos proximos dias uteis (modo recomendado: use este para sugerir horarios ao lead). " +
      "COM 'date' (YYYY-MM-DD): lista slots disponiveis naquele dia especifico.",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Data no formato YYYY-MM-DD. Omitir para obter os 3 proximos slots automaticamente.",
        },
        duration_minutes: {
          type: "number",
          description: "Duracao da reuniao em minutos. Padrao: 20",
        },
      },
      required: [],
    },
  },
  {
    name: "book_meeting",
    description: "Cria um evento no Google Calendar com Google Meet, envia convite por email ao lead e adiciona lembretes. Use apenas apos o lead confirmar o horario.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Titulo do evento. Ex: Conversa com Joao",
        },
        start_time: {
          type: "string",
          description: "Horario de inicio em ISO 8601 com offset SP. Ex: 2025-06-15T10:00:00-03:00. Use o campo 'iso' retornado por check_availability.",
        },
        end_time: {
          type: "string",
          description: "Horario de termino em ISO 8601. Call de 20 minutos: adicione 20min ao start_time. Ex: start=2025-06-15T10:00:00-03:00 -> end=2025-06-15T10:20:00-03:00",
        },
        attendee_email: {
          type: "string",
          description: "Email do lead para envio do convite (opcional)",
        },
        notes: {
          type: "string",
          description: "Notas sobre o lead ou contexto da reuniao (opcional)",
        },
      },
      required: ["summary", "start_time", "end_time"],
    },
  },
];

function buildSystemPrompt(opts: {
  agentName: string;
  businessName: string | null;
  businessInfo: string | null;
  tone: string;
  rules: string[];
  override: string | null;
  campaignName: string | null;
  niche: string | null;
  calendarEnabled: boolean;
  channel: string;
  lead: {
    displayName: string;
    city: string | null;
    company: string | null;
    handle: string | null;
  };
}): string {
  const estiloResposta = buildEstiloResposta(opts.channel);

  // Override customizado prevalece, mas o estilo de resposta e sempre anexado
  if (opts.override && opts.override.trim().length > 40) {
    return opts.override.trim() + estiloResposta;
  }

  const agentName = opts.agentName;
  const agencyName = opts.businessName ?? "nossa agencia";
  const leadName = opts.lead.displayName;
  const city = opts.lead.city ? ` em ${opts.lead.city}` : "";
  const company = opts.lead.company ? ` (${opts.lead.company})` : "";
  const canalNome = opts.channel === "email" ? "email" : "WhatsApp";

  const sections: string[] = [];

  // Identidade e funcao
  sections.push(
    `Voce e a ${agentName}, agente de vendas de ${agencyName}.` +
    ` Qualifique leads via ${canalNome} em no maximo 5 perguntas e, com 3 criterios confirmados, convide para call de 20 min com o responsavel comercial.`
  );

  // Tom
  const tomCanal = opts.channel === "email"
    ? "Profissional humano, nunca robotico."
    : "Pessoa real no WhatsApp.";
  sections.push(`Tom: ${opts.tone}. Brasileiro, direto, sem cara de bot. ${tomCanal}`);

  // Contexto do negocio
  if (opts.businessInfo) {
    sections.push(`Contexto do negocio:\n${opts.businessInfo}`);
  }

  // Campanha e nicho
  if (opts.campaignName || opts.niche) {
    sections.push(
      `Campanha: ${[opts.campaignName, opts.niche].filter(Boolean).join(" - ")}.`
    );
  }

  // Dados do lead
  sections.push(`Lead: ${leadName}${company}${city}.`);

  // Regras absolutas (condensadas)
  sections.push(
    "Regras: nunca invente dados, clientes ou numeros. Nunca prometa leads, faturamento ou mencione preco (papel da call). Sempre em portugues com acentos. Sem CAPS LOCK, sem emojis em excesso."
  );

  // Leads vindos de abordagem outbound (condensado)
  sections.push(
    "Leads inbound de prospeccao: se o contexto indicar abordagem previa, nao se reapresente. " +
    "De sequencia: reconheca o contato, qualifique e conduza para a call. " +
    "Use os dados do lead para personalizar (confirme, nao afirme; ex: 'vi que atuam com X, e isso?'). " +
    "Nao pergunte o que o contexto ja informa."
  );

  // Fluxo de qualificacao BANT (condensado)
  sections.push(
    [
      "Qualificacao BANT. REGRA DE OURO: faca UMA pergunta por mensagem, de forma natural, emendando na resposta anterior do lead. NUNCA liste varias perguntas juntas, NUNCA numere perguntas, NUNCA mande formulario (vale para email E WhatsApp). As 5 perguntas abaixo sao so um GUIA do que descobrir ao longo da conversa, uma de cada vez:",
      "- Como capta clientes hoje?",
      "- Voce decide sobre marketing ai?",
      "- Investe em divulgacao atualmente?",
      "- Se encontrarmos algo bom, quando conseguiria comecar?",
      "- Quantos clientes/mes seria um bom resultado?",
      "Com 3 de 5 sinais positivos (descobertos naturalmente, sem interrogatorio): chame qualify_lead e convide para call. Para info extra: search_knowledge. Nao anuncie ferramentas.",
    ].join("\n")
  );

  // Convite para call (condensado)
  sections.push(
    [
      `Convite para call: "${leadName}, com base no que me contou, vale uma conversa rapida. Tenho [slot1] ou [slot2], qual prefere?"`,
      `Apos confirmar: "Perfeito, ${leadName}. Confirmado: [dia_semana] [data] as [hora]. Link: [meetLink]. Quer o convite na agenda?"`,
      "Use sempre o meetLink de book_meeting, nunca o htmlLink.",
    ].join("\n")
  );

  // Tratamento de objecoes (condensado)
  sections.push(
    "Objecoes (ACK + redirect, resposta curta): sem tempo -> melhor horario | ja tem alguem -> satisfeito com resultados? | sem orcamento -> call e sem compromisso | ja tentei -> o que tentou? | manda info -> oferea 2 horarios"
  );

  // Opt-out (condensado)
  sections.push(
    "Opt-out: se recusar ou pedir para nao receber mensagens, chame registrar_opt_out e despeca-se com educacao. Nao insista."
  );

  // Ferramentas disponiveis
  const toolsList = [
    "qualify_lead: score BANT com 3+ sinais",
    "update_crm_stage: mover lead no funil",
    "search_knowledge: buscar info do negocio/servico",
    "registrar_opt_out: marcar lead como nao perturbar",
    "notify_human: acionar responsavel (STOP, HOT_LEAD, OUT_OF_SCOPE, AGGRESSIVE, BIG_TICKET, TECH_QUESTION)",
  ];
  if (opts.calendarEnabled) {
    toolsList.push(
      "check_availability: horarios livres na agenda",
      "book_meeting: criar evento no Calendar apos confirmacao"
    );
  }
  sections.push("Ferramentas: " + toolsList.join(" | "));

  // Regras adicionais do cliente
  if (opts.rules.length > 0) {
    sections.push(
      "Regras adicionais:\n" +
        opts.rules.map((r) => `- ${r}`).join("\n")
    );
  }

  // Agendamento pelo calendario (condensado)
  if (opts.calendarEnabled) {
    sections.push(
      "Agendamento: chame check_availability SEM 'date' para obter 3 slots. " +
      "Ofereça com labels (ex: 'Tenho Segunda 07/07 as 10h ou Quarta 09/07 as 14h'). " +
      "Confirmado: book_meeting com 'iso' como start_time, end_time = start + 20min. " +
      "Confirme com dia, data, hora e meetLink (nunca htmlLink). Horario de Brasilia (UTC-3)."
    );
  }

  return sections.join("\n\n") + estiloResposta;
}

/**
 * System prompt minimo para a 2a chamada apos tool_use.
 * O modelo ja tem todo o contexto no historico (tool_uses + tool_results).
 * So precisa da identidade + regra de formato para montar a resposta final.
 * Reduz o input da 2a chamada de ~2000 para ~60 tokens.
 */
function buildSlimSystemPrompt(opts: {
  agentName: string;
  channel: string;
}): string {
  return (
    `Voce e a ${opts.agentName}. Com base nos resultados das ferramentas acima, responda ao lead de forma natural.` +
    " Nao mencione que usou ferramentas. Portugues com acentos completos. Sem emojis em excesso." +
    buildEstiloResposta(opts.channel)
  );
}

/**
 * Monta a nota de contexto interno para o primeiro turno da conversa.
 * Replicado do _build_context_note do runner.py do agente_minerador_lista (somente leitura).
 */
function buildContextNote(opts: {
  agentName: string;
  hasOutboundHistory: boolean;
  lead: {
    displayName: string;
    company: string | null;
    city: string | null;
    headline: string | null;
  };
  businessName: string | null;
}): string | null {
  const blocos: string[] = [];

  if (opts.hasOutboundHistory) {
    blocos.push(
      `Este lead ja recebeu uma abordagem de prospeccao de ${opts.businessName ?? "nossa agencia"} e esta respondendo agora.` +
      ` Voce e a ${opts.agentName} e esta DANDO SEQUENCIA a essa conversa: nao se reapresente do zero nem repita a abordagem.` +
      " Reconheca o contato, faca a avaliacao/qualificacao completa normalmente" +
      " e conduza para agendar uma call de video de 20 minutos." +
      " Se o lead recusar ou pedir para nao receber mais mensagens, use registrar_opt_out e despeca-se com educacao."
    );
  }

  const partes: string[] = [];
  const ramo = opts.lead.headline?.trim();
  const cidade = opts.lead.city?.trim();
  const empresa = opts.lead.company?.trim();
  const nome = opts.lead.displayName?.split(" ")[0]?.trim();

  if (ramo) partes.push(`Ramo ${ramo}`);
  if (cidade) partes.push(`Cidade ${cidade}`);
  if (empresa) partes.push(`Empresa ${empresa}`);
  if (nome) partes.push(`Nome ${nome}`);

  if (partes.length > 0) {
    blocos.push(
      "Dados da empresa deste lead (do cadastro, podem estar imprecisos): " +
      partes.join(" | ") +
      ". Use isso para personalizar a abertura e demonstrar que conhece o negocio," +
      " mas CONFIRME em vez de afirmar (ex: 'vi que voces atuam com X, e isso mesmo?')." +
      " NAO pergunte o que ja sabe (nao pergunte o ramo/o que vende)." +
      " Trate pelo primeiro nome."
    );
  }

  if (blocos.length === 0) return null;

  return "[CONTEXTO INTERNO, nao responda a isto diretamente: " + blocos.join(" ") + "]";
}

function hasHandoffKeyword(body: string, keywords: string[]): boolean {
  const lower = body.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase().trim()));
}

async function sendWhatsApp(opts: {
  organizationId: string;
  phone: string;
  body: string;
  preferred: string;
}): Promise<{ messageId: string; provider: "meta" | "uazapi" } | null> {
  const order =
    opts.preferred === "meta"
      ? ["meta", "uazapi"]
      : opts.preferred === "uazapi"
        ? ["uazapi", "meta"]
        : ["meta", "uazapi"];

  for (const provider of order) {
    try {
      if (provider === "meta") {
        const cred = await loadWhatsAppAPICredential(opts.organizationId);
        if (!cred) continue;
        const res = await sendWhatsAppAPIMessage({
          organizationId: opts.organizationId,
          phone: opts.phone,
          body: opts.body,
        });
        return { messageId: res.messageId, provider: "meta" };
      }
      if (provider === "uazapi") {
        const cred = await loadUazAPICredential(opts.organizationId);
        if (!cred) continue;
        const res = await sendUazAPIMessage({
          organizationId: opts.organizationId,
          phone: opts.phone,
          body: opts.body,
        });
        return { messageId: res.messageId, provider: "uazapi" };
      }
    } catch (err) {
      if (
        err instanceof WhatsAppAPINotConfiguredError ||
        err instanceof UazAPINotConfiguredError
      ) {
        continue;
      }
      if (err instanceof WhatsAppAPIError || err instanceof UazAPIError) {
        console.warn(
          `[agent.reply] provider ${provider} falhou (${(err as Error).message}), tentando proximo`,
        );
        continue;
      }
      throw err;
    }
  }
  return null;
}

export async function handleAgentReply(payload: AgentReplyPayload): Promise<void> {
  const { organizationId, threadId, inboundMessageId } = payload;

  const [config] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, organizationId))
    .limit(1);

  if (!config || !config.enabled) {
    console.log(`[agent.reply] agent desabilitado para org ${organizationId}`);
    return;
  }

  const [thread] = await db
    .select()
    .from(outreachThreads)
    .where(
      and(
        eq(outreachThreads.id, threadId),
        eq(outreachThreads.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!thread) {
    console.warn(`[agent.reply] thread ${threadId} nao encontrada`);
    return;
  }

  if (thread.botPaused) {
    console.log(`[agent.reply] bot pausado (atendimento humano ativo) no thread ${threadId}`);
    return;
  }

  if (thread.channel !== "whatsapp" && thread.channel !== "email") {
    console.log(`[agent.reply] canal ${thread.channel} nao suportado`);
    return;
  }

  const [inbound] = await db
    .select()
    .from(outreachMessages)
    .where(eq(outreachMessages.id, inboundMessageId))
    .limit(1);
  if (!inbound) {
    console.warn(`[agent.reply] mensagem ${inboundMessageId} nao encontrada`);
    return;
  }

  // Dedup: se o externalMessageId ja existe em outra mensagem inbound da thread, ignorar
  if (inbound.externalMessageId) {
    const [dup] = await db
      .select({ id: outreachMessages.id })
      .from(outreachMessages)
      .where(
        and(
          eq(outreachMessages.threadId, threadId),
          eq(outreachMessages.externalMessageId, inbound.externalMessageId),
          eq(outreachMessages.direction, "inbound"),
          sql`${outreachMessages.id} != ${inboundMessageId}`,
        ),
      )
      .limit(1);
    if (dup) {
      console.log(`[agent.reply] dedup: externalMessageId ${inbound.externalMessageId} ja processado, ignorando`);
      return;
    }
  }

  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.id, thread.leadId))
    .limit(1);
  if (!lead) {
    console.warn(`[agent.reply] lead ${thread.leadId} nao encontrado`);
    return;
  }

  // Respeita opt-out: registra o inbound mas nao responde
  if (lead.doNotDisturb) {
    console.log(`[agent.reply] lead ${lead.id} com doNotDisturb=true, nao enfileirando resposta`);
    return;
  }

  // Anti-loop por JANELA DE TEMPO (nao cumulativo): conta apenas respostas
  // automaticas dos ultimos 2 minutos. Uma conversa real (humano) nunca dispara
  // dezenas de respostas em 2 minutos, entao um atendimento legitimo NUNCA trava;
  // so barra loop/eco real (rajada de respostas em segundos).
  const [countRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(outreachMessages)
    .where(
      and(
        eq(outreachMessages.threadId, threadId),
        eq(outreachMessages.direction, "outbound"),
        sql`${outreachMessages.metadata}->>'agent' = 'true'`,
        sql`${outreachMessages.createdAt} > now() - interval '2 minutes'`,
      ),
    );
  const autoReplyCount = countRow?.c ?? 0;
  if (autoReplyCount >= config.maxAutoReplies) {
    await db
      .update(outreachThreads)
      .set({ status: "awaiting_reply", updatedAt: new Date() })
      .where(eq(outreachThreads.id, threadId));
    console.log(
      `[agent.reply] anti-loop: ${config.maxAutoReplies} respostas automaticas em 2 min no thread ${threadId} (possivel loop), pausando`,
    );
    return;
  }

  if (hasHandoffKeyword(inbound.body ?? "", config.handoffKeywords)) {
    await db
      .update(outreachThreads)
      .set({ status: "replied", updatedAt: new Date() })
      .where(eq(outreachThreads.id, threadId));
    await db.insert(events).values({
      organizationId,
      type: "agent.handoff",
      entityType: "thread",
      entityId: threadId,
      data: { reason: "handoff_keyword", body: inbound.body },
    });
    console.log(`[agent.reply] handoff por palavra-chave no thread ${threadId}`);
    return;
  }

  // Lead respondeu: auto-promove no funil (monotone, nao regride).
  try {
    await promoteLeadOnInbound(organizationId, lead.id);
  } catch (err) {
    console.warn(`[agent.reply] falha ao promover stage do lead ${lead.id}`, err);
  }

  // Reseta contadores de reengajamento: o lead voltou a interagir, entao a
  // janela de 24h recomeça e futuras cutucadas podem ser enviadas se ele
  // sumir novamente.
  try {
    await db
      .update(leadsTable)
      .set({ reengageFollowupCount: 0, reengageLastAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(leadsTable.id, lead.id),
          eq(leadsTable.organizationId, organizationId),
        ),
      );
  } catch (err) {
    console.warn(
      `[agent.reply] falha ao resetar contadores de reengage do lead ${lead.id}`,
      err,
    );
  }

  const campaign = thread.miningId
    ? (
        await db
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, thread.miningId))
          .limit(1)
      )[0] ?? null
    : null;

  const historyRows = await db
    .select({
      id: outreachMessages.id,
      direction: outreachMessages.direction,
      body: outreachMessages.body,
      createdAt: outreachMessages.createdAt,
    })
    .from(outreachMessages)
    .where(eq(outreachMessages.threadId, threadId))
    .orderBy(desc(outreachMessages.createdAt))
    .limit(HISTORY_LIMIT);

  const history = historyRows.reverse();

  // Detecta se e o primeiro turno (historico so tem a mensagem inbound atual ou menos de 2 msgs)
  const isFirstTurn = history.filter((m) => m.direction === "outbound").length === 0;

  // Detecta se havia mensagens outbound antes (abordagem de prospeccao ja enviada)
  const hadOutboundBefore = history.some(
    (m) => m.direction === "outbound" && m.id !== inboundMessageId
  );

  const messages: AgentMessage[] = [];

  // Injeta nota de contexto interno no primeiro turno (replicando _build_context_note do runner.py)
  if (isFirstTurn) {
    const contextNote = buildContextNote({
      agentName: config.agentName ?? "Isabela",
      hasOutboundHistory: hadOutboundBefore,
      lead: {
        displayName: lead.displayName,
        company: lead.company,
        city: lead.city,
        headline: lead.headline,
      },
      businessName: config.businessName,
    });
    if (contextNote) {
      messages.push({ role: "user", content: contextNote });
    }
  }

  // Historico real da thread
  for (const m of history) {
    messages.push({
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.body ?? "",
    });
  }

  // Verifica se o Google Calendar esta configurado consultando apenas o banco de dados,
  // sem fazer nenhuma chamada externa. Isso elimina uma requisicao HTTP desnecessaria
  // a cada mensagem recebida.
  let calendarEnabled = false;
  try {
    await getOrgCredential(organizationId, "google_oauth");
    calendarEnabled = true;
  } catch (err) {
    if (!(err instanceof MissingCredentialError)) {
      console.warn(`[agent.reply] erro inesperado ao verificar credencial google_oauth thread=${threadId}`, err);
    }
    calendarEnabled = false;
  }

  const systemPrompt = buildSystemPrompt({
    agentName: config.agentName ?? "Isabela",
    businessName: config.businessName,
    businessInfo: config.businessInfo,
    tone: config.tone,
    rules: config.rules,
    override: config.systemPromptOverride,
    campaignName: campaign?.name ?? null,
    niche: campaign?.niche ?? null,
    calendarEnabled,
    channel: thread.channel,
    lead: {
      displayName: lead.displayName,
      city: lead.city,
      company: lead.company,
      handle: lead.handle,
    },
  });

  // maxTokens varia por canal: WhatsApp requer mensagens curtas (<=200 tokens);
  // email permite paragrafos mais completos (<=400 tokens).
  const maxTokensFirst = thread.channel === "email" ? 400 : 200;

  let reply;
  try {
    reply = await generateAgentReply({
      organizationId,
      systemPrompt,
      messages,
      model: config.model,
      temperature: config.temperature / 100,
      maxTokens: maxTokensFirst,
      tools: [...SDR_TOOLS, ...(calendarEnabled ? CALENDAR_TOOLS : [])],
    });
  } catch (err) {
    console.error(`[agent.reply] falha ao gerar resposta no thread ${threadId}`, err);
    throw err;
  }

  // Executar ferramentas se o modelo solicitou
  let optOutCalled = false;
  if (reply.toolUses.length > 0) {
    const toolResults: Array<{ toolUseId: string; content: string }> = [];

    for (const toolUse of reply.toolUses) {
      // Tools de SDR (qualify_lead, update_crm_stage, search_knowledge, registrar_opt_out, notify_human)
      const sdrResult = await dispatchSdrTool(
        organizationId,
        lead.id,
        toolUse.toolName,
        toolUse.input,
        threadId,
      );
      if (sdrResult !== null) {
        if (toolUse.toolName === "registrar_opt_out") optOutCalled = true;
        toolResults.push({
          toolUseId: toolUse.toolUseId,
          content: JSON.stringify(sdrResult),
        });
        continue;
      }

      if (calendarEnabled && toolUse.toolName === "check_availability") {
        try {
          const date = toolUse.input.date ? String(toolUse.input.date).trim() : "";
          const duration = Number(toolUse.input.duration_minutes ?? 20);
          let formatted: string;

          if (!date) {
            // Sem data: escaneia proximos dias uteis e retorna 3 slots com labels
            // (espelhando _list_slots_sync do schedule_call.py do lista)
            const slots = await scanCalendarSlots(organizationId, 5, duration);
            if (slots.length === 0) {
              formatted = "Nenhum horario disponivel nos proximos dias uteis.";
            } else {
              // Retorna label amigavel E iso para o agente usar em book_meeting
              formatted = slots.map((s) => `${s.label} (iso: ${s.iso})`).join("\n");
            }
          } else {
            // Com data especifica: lista slots naquele dia
            const slots = await checkCalendarAvailability(organizationId, date, duration);
            if (slots.length === 0) {
              formatted = `Nenhum horario disponivel em ${date}.`;
            } else {
              formatted = slots.map((s) => {
                const startLabel = new Date(s.start).toLocaleString("pt-BR", {
                  timeZone: "America/Sao_Paulo",
                  weekday: "short",
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                });
                return `${startLabel} (iso: ${s.start})`;
              }).join("\n");
            }
          }

          toolResults.push({ toolUseId: toolUse.toolUseId, content: formatted });
        } catch {
          toolResults.push({ toolUseId: toolUse.toolUseId, content: "Erro ao verificar disponibilidade." });
        }
        continue;
      }

      if (calendarEnabled && toolUse.toolName === "book_meeting") {
        try {
          const attendeeEmail = toolUse.input.attendee_email
            ? String(toolUse.input.attendee_email)
            : undefined;
          const event = await createCalendarEvent(organizationId, {
            summary: String(toolUse.input.summary ?? "Reuniao"),
            description: toolUse.input.notes ? String(toolUse.input.notes) : undefined,
            startTime: String(toolUse.input.start_time),
            endTime: String(toolUse.input.end_time),
            attendeeEmail,
            attendeeName: lead.displayName,
          });

          // Persiste booking, avanca stage para "proposta" (call agendada) e registra activity.
          try {
            await persistCallBooking({
              organizationId,
              leadId: lead.id,
              scheduledAt: new Date(event.start),
              googleEventId: event.id ?? null,
              attendeeEmail: attendeeEmail ?? null,
              meetLink: event.meetLink ?? null,
            });
          } catch (persistErr) {
            console.warn(
              `[agent.reply] falha ao persistir call booking (evento ja criado no calendar) thread=${threadId}`,
              persistErr,
            );
          }

          const info = [
            `Evento criado: ${event.summary}`,
            `Inicio: ${new Date(event.start).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
            event.meetLink ? `Link Meet: ${event.meetLink}` : "",
          ].filter(Boolean).join("\n");
          toolResults.push({ toolUseId: toolUse.toolUseId, content: info });
        } catch {
          toolResults.push({ toolUseId: toolUse.toolUseId, content: "Erro ao criar evento no calendario." });
        }
        continue;
      }

      // CRITICO 2: tool nao reconhecida — garante que todo toolUseId receba um result,
      // evitando 400 ("tool_use sem tool_result correspondente") em ambos os paths.
      console.warn(`[agent.reply] tool nao mapeada: ${toolUse.toolName} thread=${threadId}`);
      toolResults.push({ toolUseId: toolUse.toolUseId, content: "tool nao disponivel" });
    }

    // Segunda chamada ao modelo com resultados das ferramentas
    if (toolResults.length > 0) {
      // Serializa com chaves namespacadas para evitar falso-positivo nos conversores
      // (serializeToolUses / serializeToolResults produzem { __mnr_tool_uses__: [...] }
      // e { __mnr_tool_results__: [...] } que os conversores Anthropic e OpenAI reconhecem).
      const assistantContent = serializeToolUses(
        reply.toolUses.map((t) => ({
          id: t.toolUseId,
          name: t.toolName,
          input: t.input,
        }))
      );
      const toolResultMessages: AgentMessage[] = [
        ...messages,
        { role: "assistant", content: assistantContent },
      ];

      const userToolResultContent = serializeToolResults(
        toolResults.map((r) => ({
          tool_use_id: r.toolUseId,
          content: r.content,
        }))
      );

      // CRITICO 1: passa tools na 2a chamada — obrigatorio pois o historico
      // contem blocos tool_use/tool_result; sem tools a API retorna 400.
      const activeTools = [...SDR_TOOLS, ...(calendarEnabled ? CALENDAR_TOOLS : [])];

      // System prompt reduzido para a 2a chamada: o modelo ja tem contexto completo
      // no historico (tool_uses + tool_results). Passa so identidade + regra de formato,
      // economizando ~1900 tokens de input em toda conversa que usa ferramentas.
      const slimSystemPrompt = buildSlimSystemPrompt({
        agentName: config.agentName ?? "Isabela",
        channel: thread.channel,
      });

      try {
        // Segunda chamada apos tool use: limite menor, pois o modelo so precisa formatar
        // a resposta final com base nos resultados ja retornados pelas ferramentas.
        const followUp = await generateAgentReply({
          organizationId,
          systemPrompt: slimSystemPrompt,
          messages: [
            ...toolResultMessages,
            { role: "user", content: userToolResultContent },
          ],
          model: config.model,
          temperature: config.temperature / 100,
          maxTokens: 200,
          tools: activeTools,
        });
        if (followUp.text) {
          reply = { ...reply, text: followUp.text };
        }
      } catch (err) {
        console.error(`[agent.reply] falha na segunda chamada apos tool use no thread ${threadId}`, err);
      }
    }
  }

  const replyText = reply.text.trim();
  if (!replyText || replyText.length < 3) {
    console.warn(`[agent.reply] resposta vazia para thread ${threadId}`);
    return;
  }

  const now = new Date();

  // Insere a mensagem outbound antes de tentar o envio para garantir rastreabilidade.
  const [outbound] = await db
    .insert(outreachMessages)
    .values({
      organizationId,
      threadId,
      direction: "outbound",
      status: "pending",
      step: thread.currentStep,
      body: replyText,
      metadata: {
        agent: true,
        model: reply.model,
        costUsd: reply.costUsd,
        inputTokens: reply.inputTokens,
        outputTokens: reply.outputTokens,
      },
    })
    .returning({ id: outreachMessages.id });

  if (!outbound) return;

  // ---- WhatsApp ----
  if (thread.channel === "whatsapp") {
    if (!lead.phone) {
      await db
        .update(outreachMessages)
        .set({ status: "failed", errorReason: "lead sem telefone", updatedAt: new Date() })
        .where(eq(outreachMessages.id, outbound.id));
      console.warn(`[agent.reply] lead ${lead.id} sem telefone`);
      return;
    }

    const sent = await sendWhatsApp({
      organizationId,
      phone: lead.phone,
      body: replyText,
      preferred: config.preferredProvider,
    });

    if (!sent) {
      await db
        .update(outreachMessages)
        .set({
          status: "failed",
          errorReason: "nenhum provider whatsapp disponivel",
          updatedAt: new Date(),
        })
        .where(eq(outreachMessages.id, outbound.id));
      throw new Error("nenhum provider whatsapp configurado para agent");
    }

    await db
      .update(outreachMessages)
      .set({
        status: "sent",
        externalMessageId: sent.messageId,
        sentAt: now,
        metadata: {
          agent: true,
          model: reply.model,
          costUsd: reply.costUsd,
          inputTokens: reply.inputTokens,
          outputTokens: reply.outputTokens,
          provider: sent.provider,
        },
        updatedAt: now,
      })
      .where(eq(outreachMessages.id, outbound.id));

    // IMPORTANTE 6: nao sobrescrever "dead" que registrar_opt_out gravou durante
    // a execucao das tools (a resposta de despedida ainda e enviada, mas o status
    // "dead" deve ser preservado para impedir novos envios).
    await db
      .update(outreachThreads)
      .set({
        status: optOutCalled ? "dead" : "active",
        lastMessageAt: now,
        lastOutboundAt: now,
        updatedAt: now,
      })
      .where(eq(outreachThreads.id, threadId));

    await db.insert(events).values({
      organizationId,
      type: "agent.reply.sent",
      entityType: "thread",
      entityId: threadId,
      data: {
        provider: sent.provider,
        inputTokens: reply.inputTokens,
        outputTokens: reply.outputTokens,
        costUsd: reply.costUsd,
      },
    });
    return;
  }

  // ---- Email ----
  if (thread.channel === "email") {
    if (!lead.email) {
      await db
        .update(outreachMessages)
        .set({ status: "failed", errorReason: "lead sem email", updatedAt: new Date() })
        .where(eq(outreachMessages.id, outbound.id));
      console.warn(`[agent.reply] lead ${lead.id} sem email`);
      return;
    }

    // Assunto: pega do primeiro outbound da thread e prefixa "Re:" se necessario.
    const [firstOutbound] = await db
      .select({ subject: outreachMessages.subject })
      .from(outreachMessages)
      .where(
        and(
          eq(outreachMessages.threadId, threadId),
          eq(outreachMessages.direction, "outbound"),
        ),
      )
      .orderBy(asc(outreachMessages.createdAt))
      .limit(1);

    const baseSubject = firstOutbound?.subject ?? "Acompanhamento";
    const emailSubject = baseSubject.startsWith("Re:") ? baseSubject : `Re: ${baseSubject}`;

    // Threading: In-Reply-To usa o externalMessageId da mensagem inbound que acionou este job.
    // O lead respondeu aquele email; o nosso reply deve referenciar ele para o cliente de email
    // reconhecer como parte da mesma conversa.
    const inReplyToId = inbound.externalMessageId ?? null;

    let emailMessageId: string | null = null;
    try {
      const result = await sendBrevoEmail({
        organizationId,
        to: lead.email,
        toName: lead.displayName ?? undefined,
        subject: emailSubject,
        body: replyText,
        ...(inReplyToId ? { inReplyTo: inReplyToId } : {}),
      });
      emailMessageId = result.messageId;
    } catch (err) {
      const errMsg =
        err instanceof BrevoNotConfiguredError
          ? "brevo nao configurado"
          : err instanceof Error
            ? err.message
            : String(err);
      await db
        .update(outreachMessages)
        .set({ status: "failed", errorReason: errMsg, updatedAt: new Date() })
        .where(eq(outreachMessages.id, outbound.id));
      throw err;
    }

    // Persiste o novo messageId para que a proxima resposta do lead seja casada
    // no webhook email-inbound (campo externalMessageId dos outbound emails).
    await db
      .update(outreachMessages)
      .set({
        status: "sent",
        externalMessageId: emailMessageId,
        subject: emailSubject,
        sentAt: now,
        metadata: {
          agent: true,
          model: reply.model,
          costUsd: reply.costUsd,
          inputTokens: reply.inputTokens,
          outputTokens: reply.outputTokens,
          provider: "brevo",
        },
        updatedAt: now,
      })
      .where(eq(outreachMessages.id, outbound.id));

    // IMPORTANTE 6 (igual ao WhatsApp): preservar "dead" gravado por registrar_opt_out.
    await db
      .update(outreachThreads)
      .set({
        status: optOutCalled ? "dead" : "active",
        lastMessageAt: now,
        lastOutboundAt: now,
        updatedAt: now,
      })
      .where(eq(outreachThreads.id, threadId));

    await db.insert(events).values({
      organizationId,
      type: "agent.reply.sent",
      entityType: "thread",
      entityId: threadId,
      data: {
        provider: "brevo",
        channel: "email",
        inputTokens: reply.inputTokens,
        outputTokens: reply.outputTokens,
        costUsd: reply.costUsd,
      },
    });
    return;
  }

  // Canal nao suportado (nao deveria chegar aqui dado o guard no inicio).
  await db
    .update(outreachMessages)
    .set({
      status: "failed",
      errorReason: `canal ${thread.channel} nao suportado`,
      updatedAt: new Date(),
    })
    .where(eq(outreachMessages.id, outbound.id));
  console.warn(`[agent.reply] canal ${thread.channel} nao suportado no envio`);
}
