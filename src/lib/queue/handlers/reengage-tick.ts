/**
 * Handler do cron reengage.tick (a cada 15 min).
 *
 * Detecta leads que responderam e depois silenciaram, gera uma "cutucada"
 * inteligente via LLM (que pode decidir NAO_ENVIAR), e envia pelo canal
 * correto (whatsapp ou email). Respeita quiet hours, doNotDisturb, botPaused,
 * agentConfigs.enabled e limite de 2 tentativas por lead por janela de 24h.
 *
 * Multi-tenant: cada query inclui organization_id e todas as operacoes de
 * leitura/escrita carregam o organizationId do lead.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { leads as leadsTable } from "@/db/schema/leads";
import { outreachMessages, outreachThreads } from "@/db/schema/outreach";
import { events } from "@/db/schema/events";
import { generateReengageMessage } from "@/lib/clients/anthropic";
import {
  loadWhatsAppAPICredential,
  sendWhatsAppAPIMessage,
  WhatsAppAPINotConfiguredError,
  WhatsAppAPIError,
} from "@/lib/clients/whatsapp-api";
import {
  loadUazAPICredential,
  sendUazAPIMessage,
  UazAPINotConfiguredError,
  UazAPIError,
} from "@/lib/clients/whatsapp-uazapi";
import { sendBrevoEmail, BrevoNotConfiguredError } from "@/lib/clients/brevo";

// -------- Hora local em Sao Paulo --------

// Exportada para reuso pelo daily-plan.ts (mesma nocao de quiet hours).
export function horaLocalSaoPaulo(): number {
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(fmt.format(new Date()), 10);
}

// -------- Utilitarios --------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function soAlfanumerico(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// -------- Tipo da linha retornada pela query de elegibilidade --------

type ReengageRow = {
  lead_id: string;
  organization_id: string;
  phone: string | null;
  email: string | null;
  display_name: string;
  fu_count: number | string;
  thread_id: string;
  channel: string;
  agent_model: string;
  agent_name: string | null;
  follow_up_model: string | null;
  last_inbound_at: Date | string | null;
};

// -------- Construcao da transcricao legivel --------

function montarTranscricao(
  messages: Array<{ direction: string; body: string | null }>,
): string {
  const linhas: string[] = [];
  for (const msg of messages) {
    const texto = (msg.body ?? "").trim();
    if (!texto) continue;
    // Pula nota de contexto interno injetada no primeiro turno do bot
    if (texto.startsWith("[CONTEXTO INTERNO")) continue;
    // Pula blocos serializados de tool_use/tool_result (nao sao mensagens reais)
    if (
      texto.startsWith("{") &&
      (texto.includes("__mnr_tool_uses__") ||
        texto.includes("__mnr_tool_results__"))
    )
      continue;
    if (msg.direction === "inbound") {
      linhas.push(`Cliente: ${texto}`);
    } else {
      linhas.push(`Agente: ${texto}`);
    }
  }
  return linhas.join("\n");
}

// -------- Envio via WhatsApp (Meta Cloud API > UazAPI) --------

async function sendWhatsApp(opts: {
  organizationId: string;
  phone: string;
  body: string;
}): Promise<{ messageId: string; provider: string } | null> {
  for (const provider of ["meta", "uazapi"] as const) {
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
      )
        continue;
      if (err instanceof WhatsAppAPIError || err instanceof UazAPIError) {
        console.warn(
          `[reengage] provider ${provider} falhou: ${(err as Error).message}`,
        );
        continue;
      }
      throw err;
    }
  }
  return null;
}

// -------- Handler principal --------

export async function handleReengageTick(): Promise<void> {
  // Quiet hours: entre 21h e 8h (Sao Paulo) nao envia nada. Rodar o cron com
  // frequencia e seguro porque essa verificacao e barata.
  const hora = horaLocalSaoPaulo();
  if (hora >= 21 || hora < 8) {
    return;
  }

  // Busca leads elegiveis em todas as orgs. Criterios (espelham o worker do
  // agente_minerador_lista, adaptados para o schema multi-tenant deste projeto):
  //   - doNotDisturb = false
  //   - agentConfigs.enabled = true
  //   - Thread ativa (whatsapp ou email, nao morta/pausada)
  //   - Lead respondeu pelo menos uma vez (existe mensagem inbound)
  //   - Ultimo inbound dentro da janela de 24h
  //   - Ultima mensagem da thread e outbound (lead ficou em silencio apos nossa resposta)
  //   - Silencio ha mais de 1h
  //   - reengage_followup_count < 2 (max 2 tentativas por janela)
  //   - reengage_last_at nulo OU ha mais de 1h (evita rajada de LLM)
  const result = await db.execute<ReengageRow>(sql`
    SELECT
      l.id                                                          AS lead_id,
      l.organization_id,
      l.phone,
      l.email,
      l.display_name,
      COALESCE(l.reengage_followup_count, 0)                       AS fu_count,
      t.id                                                          AS thread_id,
      t.channel,
      ac.model                                                      AS agent_model,
      ac.agent_name,
      ac.follow_up_model,
      (
        SELECT MAX(COALESCE(mi.sent_at, mi.created_at))
        FROM outreach_messages mi
        WHERE mi.thread_id = t.id AND mi.direction = 'inbound'
      )                                                             AS last_inbound_at
    FROM leads l
    JOIN outreach_threads t
      ON  t.lead_id  = l.id
      AND t.channel IN ('whatsapp', 'email')
      AND t.bot_paused = FALSE
      AND t.status NOT IN ('dead', 'failed', 'finished')
    JOIN agent_configs ac
      ON  ac.organization_id = l.organization_id
      AND ac.enabled = TRUE
    WHERE l.do_not_disturb = FALSE
      AND l.deleted_at IS NULL
      AND COALESCE(l.reengage_followup_count, 0) < 2
      AND (
            l.reengage_last_at IS NULL
            OR l.reengage_last_at < NOW() - INTERVAL '1 hour'
          )
      AND EXISTS (
            SELECT 1 FROM outreach_messages mi
            WHERE mi.thread_id = t.id AND mi.direction = 'inbound'
          )
      AND (
            SELECT MAX(COALESCE(mi.sent_at, mi.created_at))
            FROM outreach_messages mi
            WHERE mi.thread_id = t.id AND mi.direction = 'inbound'
          ) > NOW() - INTERVAL '24 hours'
      AND (
            SELECT m.direction
            FROM outreach_messages m
            WHERE m.thread_id = t.id
            ORDER BY COALESCE(m.sent_at, m.created_at) DESC
            LIMIT 1
          ) = 'outbound'
      AND (
            SELECT COALESCE(m.sent_at, m.created_at)
            FROM outreach_messages m
            WHERE m.thread_id = t.id
            ORDER BY COALESCE(m.sent_at, m.created_at) DESC
            LIMIT 1
          ) < NOW() - INTERVAL '1 hour'
    LIMIT 50
  `);

  const rows = Array.from(result) as ReengageRow[];
  if (rows.length === 0) return;

  console.log(`[reengage] ${rows.length} lead(s) elegivel(eis) para reativacao`);

  for (const row of rows) {
    const fuCount = Number(row.fu_count) || 0;
    const nivel = fuCount + 1; // 1 = primeira reativacao, 2 = ultima (perto do fim da janela)

    // A 2a reativacao so dispara perto do fim da janela (>= 23h de silencio desde o
    // ultimo inbound). Isso evita cutucar duas vezes em sequencia.
    if (nivel === 2) {
      const ultimoInbound = row.last_inbound_at
        ? new Date(row.last_inbound_at)
        : null;
      if (!ultimoInbound) {
        console.log(
          `[reengage] nivel 2: sem ultimo_inbound para lead=${row.lead_id}, skip`,
        );
        continue;
      }
      const silencioMs = Date.now() - ultimoInbound.getTime();
      if (silencioMs < 23 * 60 * 60 * 1000) continue;
    }

    // Marca a tentativa ANTES de chamar o LLM (otimista): garante no maximo
    // 2 avaliacoes por lead e 1 chamada de LLM por hora, mesmo que o modelo
    // decida nao enviar.
    await db
      .update(leadsTable)
      .set({
        reengageFollowupCount: nivel,
        reengageLastAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(leadsTable.id, row.lead_id),
          eq(leadsTable.organizationId, row.organization_id),
        ),
      );

    try {
      // Carrega historico da thread para montar a transcricao
      const msgRows = await db
        .select({
          direction: outreachMessages.direction,
          body: outreachMessages.body,
          createdAt: outreachMessages.createdAt,
        })
        .from(outreachMessages)
        .where(eq(outreachMessages.threadId, row.thread_id))
        .orderBy(asc(outreachMessages.createdAt));

      const transcricao = montarTranscricao(msgRows);
      if (!transcricao) {
        console.log(
          `[reengage] sem transcricao para lead=${row.lead_id}, skip`,
        );
        continue;
      }

      // Modelo: followUpModel da org > model da org > default Claude
      const reengageModel =
        (row.follow_up_model ?? row.agent_model ?? "").trim() ||
        "claude-sonnet-4-5";

      let mensagem: string;
      try {
        mensagem = await generateReengageMessage(
          row.organization_id,
          transcricao,
          reengageModel,
          row.agent_name ?? "Isabela",
        );
      } catch (err) {
        console.error(
          `[reengage] generateReengageMessage falhou lead=${row.lead_id}:`,
          err,
        );
        continue;
      }

      // Se o modelo decidiu nao reativar, os contadores ja foram marcados e
      // o lead nao recebe mensagem. Correto e intencional.
      if (!mensagem || soAlfanumerico(mensagem) === "naoenviar") {
        console.log(
          `[reengage] LLM decidiu nao reativar lead=${row.lead_id} nivel=${nivel}`,
        );
        continue;
      }

      const now = new Date();
      let sentMessageId: string | null = null;
      let sentProvider: string | null = null;

      // ---- Envio via WhatsApp ----
      if (row.channel === "whatsapp") {
        if (!row.phone) {
          console.warn(
            `[reengage] lead sem telefone lead=${row.lead_id}, skip`,
          );
          continue;
        }
        const sent = await sendWhatsApp({
          organizationId: row.organization_id,
          phone: row.phone,
          body: mensagem,
        });
        if (!sent) {
          console.warn(
            `[reengage] nenhum provider whatsapp disponivel lead=${row.lead_id}`,
          );
          continue;
        }
        sentMessageId = sent.messageId;
        sentProvider = sent.provider;
      }
      // ---- Envio via Email ----
      else if (row.channel === "email") {
        if (!row.email) {
          console.warn(`[reengage] lead sem email lead=${row.lead_id}, skip`);
          continue;
        }

        // Assunto: vem do primeiro outbound da thread.
        const [firstOutbound] = await db
          .select({ subject: outreachMessages.subject })
          .from(outreachMessages)
          .where(
            and(
              eq(outreachMessages.threadId, row.thread_id),
              eq(outreachMessages.direction, "outbound"),
            ),
          )
          .orderBy(asc(outreachMessages.createdAt))
          .limit(1);

        // inReplyTo: externalMessageId do ultimo outbound — garante que o cliente
        // de email exiba o reengage dentro do mesmo thread, evitando que caia
        // como mensagem avulsa (spam).
        const [lastOutbound] = await db
          .select({ externalMessageId: outreachMessages.externalMessageId })
          .from(outreachMessages)
          .where(
            and(
              eq(outreachMessages.threadId, row.thread_id),
              eq(outreachMessages.direction, "outbound"),
            ),
          )
          .orderBy(desc(outreachMessages.createdAt))
          .limit(1);

        const baseSubject = firstOutbound?.subject ?? "Acompanhamento";
        const emailSubject = baseSubject.startsWith("Re:")
          ? baseSubject
          : `Re: ${baseSubject}`;
        const inReplyToId = lastOutbound?.externalMessageId ?? null;

        try {
          const res = await sendBrevoEmail({
            organizationId: row.organization_id,
            to: row.email,
            toName: row.display_name,
            subject: emailSubject,
            body: mensagem,
            ...(inReplyToId
              ? { inReplyTo: inReplyToId, references: inReplyToId }
              : {}),
          });
          sentMessageId = res.messageId;
          sentProvider = "brevo";
        } catch (err) {
          if (err instanceof BrevoNotConfiguredError) {
            console.warn(
              `[reengage] brevo nao configurado org=${row.organization_id}`,
            );
          } else {
            console.error(
              `[reengage] sendBrevoEmail falhou lead=${row.lead_id}:`,
              err,
            );
          }
          continue;
        }
      } else {
        console.warn(
          `[reengage] canal ${row.channel} nao suportado lead=${row.lead_id}`,
        );
        continue;
      }

      // Grava a mensagem outbound na thread
      await db.insert(outreachMessages).values({
        organizationId: row.organization_id,
        threadId: row.thread_id,
        direction: "outbound",
        status: "sent",
        step: 0,
        body: mensagem,
        externalMessageId: sentMessageId ?? null,
        sentAt: now,
        metadata: {
          agent: true,
          reengage: true,
          reengageLevel: nivel,
          provider: sentProvider,
          model: reengageModel,
        },
      });

      // Atualiza timestamps da thread (sem alterar status para nao interferir
      // com o fluxo de estados do agente inbound)
      await db
        .update(outreachThreads)
        .set({
          lastMessageAt: now,
          lastOutboundAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(outreachThreads.id, row.thread_id),
            eq(outreachThreads.organizationId, row.organization_id),
          ),
        );

      // Evento de auditoria
      await db.insert(events).values({
        organizationId: row.organization_id,
        type: "agent.reengage.sent",
        entityType: "thread",
        entityId: row.thread_id,
        data: {
          leadId: row.lead_id,
          nivel,
          provider: sentProvider,
          model: reengageModel,
        },
      });

      console.log(
        `[reengage] reativacao enviada lead=${row.lead_id} nivel=${nivel} provider=${sentProvider}`,
      );
    } catch (err) {
      console.error(`[reengage] erro ao processar lead=${row.lead_id}:`, err);
    }

    // Jitter de 2 a 6s entre leads para nao criar rajada de mensagens.
    await sleep(2000 + Math.floor(Math.random() * 4000));
  }
}
