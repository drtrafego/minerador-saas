import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, asc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { leads } from "@/db/schema/leads";
import { agentConfigs } from "@/db/schema/agent";
import { outreachThreads, outreachMessages } from "@/db/schema/outreach";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type { AgentReplyPayload } from "@/lib/queue/types";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Validacao do token
// ---------------------------------------------------------------------------

function comparacaoSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function tokenValido(req: NextRequest): boolean {
  const esperado = process.env.BREVO_WEBHOOK_SECRET;
  if (!esperado) return false;

  const headerToken = req.headers.get("x-webhook-token");
  if (headerToken && comparacaoSegura(headerToken, esperado)) return true;

  const auth = req.headers.get("authorization");
  if (auth) {
    const semBearer = auth.replace(/^Bearer\s+/i, "").trim();
    if (comparacaoSegura(semBearer, esperado)) return true;
  }

  const queryToken = req.nextUrl.searchParams.get("token");
  if (queryToken && comparacaoSegura(queryToken, esperado)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Schema do payload Brevo Inbound Parsing
// ---------------------------------------------------------------------------

const mailboxSchema = z
  .object({ Address: z.string().nullish(), Name: z.string().nullish() })
  .passthrough();

const inboundSchema = z
  .object({
    From: mailboxSchema.nullish(),
    Subject: z.string().nullish(),
    RawTextBody: z.string().nullish(),
    ExtractedMarkdownMessage: z.string().nullish(),
    MessageId: z.string().nullish(),
    InReplyTo: z.string().nullish(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Resolucao de thread pelo InReplyTo e fallback por email
// ---------------------------------------------------------------------------

type ThreadContext = {
  organizationId: string;
  threadId: string;
  leadId: string;
  currentStatus: string;
};

async function acharThreadContext(
  inReplyTo: string | null,
  fromAddress: string | null,
): Promise<ThreadContext | null> {
  // Tentativa principal: achar pelo In-Reply-To que casa com o externalMessageId
  // de uma mensagem outbound de email que enviamos.
  if (inReplyTo) {
    // O Brevo pode enviar o id com ou sem angulares, tentamos as duas formas.
    const variantes = new Set([inReplyTo]);
    if (inReplyTo.startsWith("<") && inReplyTo.endsWith(">")) {
      variantes.add(inReplyTo.slice(1, -1));
    } else {
      variantes.add(`<${inReplyTo}>`);
    }

    for (const id of variantes) {
      const [msg] = await db
        .select({
          threadId: outreachMessages.threadId,
          organizationId: outreachMessages.organizationId,
        })
        .from(outreachMessages)
        .where(eq(outreachMessages.externalMessageId, id))
        .limit(1);

      if (msg) {
        const [thread] = await db
          .select({
            leadId: outreachThreads.leadId,
            status: outreachThreads.status,
          })
          .from(outreachThreads)
          .where(
            and(
              eq(outreachThreads.id, msg.threadId),
              eq(outreachThreads.organizationId, msg.organizationId),
            ),
          )
          .limit(1);

        if (thread) {
          return {
            organizationId: msg.organizationId,
            threadId: msg.threadId,
            leadId: thread.leadId,
            currentStatus: thread.status,
          };
        }
      }
    }
  }

  // Fallback: achar lead por email do remetente e pegar sua thread de email.
  // Se o mesmo email existir em orgs diferentes, nao processa (ambiguidade).
  if (fromAddress) {
    const allLeads = await db
      .select({ id: leads.id, organizationId: leads.organizationId })
      .from(leads)
      .where(ilike(leads.email, fromAddress))
      .orderBy(asc(leads.createdAt))
      .limit(10);

    if (allLeads.length > 0) {
      const orgIds = [...new Set(allLeads.map((l) => l.organizationId))];
      if (orgIds.length > 1) {
        console.log(
          `[webhook/email-inbound] conflito de org para email=${fromAddress} (${orgIds.length} orgs), skip`,
        );
        return null;
      }

      // Todos na mesma org: usa o lead mais antigo (order by created_at asc).
      const lead = allLeads[0];
      const [thread] = await db
        .select({
          id: outreachThreads.id,
          leadId: outreachThreads.leadId,
          status: outreachThreads.status,
        })
        .from(outreachThreads)
        .where(
          and(
            eq(outreachThreads.organizationId, lead.organizationId),
            eq(outreachThreads.leadId, lead.id),
            eq(outreachThreads.channel, "email"),
          ),
        )
        .limit(1);

      if (thread) {
        return {
          organizationId: lead.organizationId,
          threadId: thread.id,
          leadId: lead.id,
          currentStatus: thread.status,
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  if (!tokenValido(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  // O Brevo inbound parsing envelopa o(s) email(s) num array "items".
  // Aceita os dois formatos: item dentro de items[] ou objeto no topo.
  const alvo =
    json && Array.isArray(json.items) && json.items.length > 0
      ? json.items[0]
      : json;
  const parsed = inboundSchema.safeParse(alvo);
  if (!parsed.success) {
    // 200 de proposito: payload nao reconhecido nao deve fazer o Brevo reenviar.
    return NextResponse.json({ skipped: "ignored" }, { status: 200 });
  }

  const fromAddress = parsed.data.From?.Address?.trim().toLowerCase() || null;
  if (!fromAddress) {
    return NextResponse.json({ skipped: "ignored" }, { status: 200 });
  }

  const inReplyTo = parsed.data.InReplyTo?.trim() || null;
  const ctx = await acharThreadContext(inReplyTo, fromAddress);
  if (!ctx) {
    console.log(
      `[webhook/email-inbound] thread nao encontrada: inReplyTo=${inReplyTo} from=${fromAddress}`,
    );
    return NextResponse.json({ skipped: "not_found" }, { status: 200 });
  }

  const { organizationId, threadId, leadId, currentStatus } = ctx;
  const messageId = parsed.data.MessageId?.trim() || null;

  const body =
    parsed.data.ExtractedMarkdownMessage?.trim() ||
    parsed.data.RawTextBody?.trim() ||
    "";

  const subject = parsed.data.Subject?.trim() || null;
  const now = new Date();

  // Dedup atomico: INSERT ... ON CONFLICT DO NOTHING apoiado no indice unico parcial
  // outreach_messages_inbound_msg_id_idx (thread_id, external_message_id) WHERE direction='inbound'.
  // Se o messageId ja existir na thread, o insert e ignorado e returning fica vazio.
  const [inserted] = await db
    .insert(outreachMessages)
    .values({
      organizationId,
      threadId,
      direction: "inbound",
      status: "received",
      body: body || "(sem conteudo)",
      subject,
      externalMessageId: messageId,
      metadata: {
        source: "brevo-inbound",
        from: fromAddress,
        subject: subject ?? undefined,
      },
    })
    .onConflictDoNothing()
    .returning({ id: outreachMessages.id });

  if (!inserted) {
    console.log(
      `[webhook/email-inbound] dedup: messageId ${messageId} ja processado, ignorado`,
    );
    return NextResponse.json({ skipped: "duplicate" }, { status: 200 });
  }

  // Atualiza thread: so muda status para "replied" se estava active ou awaiting_reply.
  // Sempre atualiza os timestamps de inbound para o inbox ordenar corretamente.
  await db
    .update(outreachThreads)
    .set({
      ...(currentStatus === "active" || currentStatus === "awaiting_reply"
        ? { status: "replied" as const }
        : {}),
      lastInboundAt: now,
      lastMessageAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(outreachThreads.id, threadId),
        eq(outreachThreads.organizationId, organizationId),
      ),
    );

  // Verifica opt-out do lead.
  const [leadRecord] = await db
    .select({ doNotDisturb: leads.doNotDisturb })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)))
    .limit(1);

  if (leadRecord?.doNotDisturb) {
    console.log(
      `[webhook/email-inbound] lead ${leadId} com doNotDisturb=true, inbound registrado sem resposta automatica`,
    );
    return NextResponse.json({ ok: true });
  }

  // Verifica se o agente esta habilitado para a org.
  const [config] = await db
    .select({ enabled: agentConfigs.enabled })
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, organizationId))
    .limit(1);

  if (config?.enabled) {
    try {
      const boss = await getBoss();
      const queuePayload: AgentReplyPayload = {
        organizationId,
        threadId,
        inboundMessageId: inserted.id,
      };
      await boss.send(QUEUES.agentReply, queuePayload);
    } catch (err) {
      console.error("[webhook/email-inbound] falha ao enfileirar agent.reply", err);
    }
  }

  return NextResponse.json({ ok: true });
}
