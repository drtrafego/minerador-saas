import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { credentials } from "@/db/schema/credentials";
import { outreachThreads, outreachMessages } from "@/db/schema/outreach";
import { leads } from "@/db/schema/leads";
import { agentConfigs } from "@/db/schema/agent";
import { decryptCredential } from "@/lib/crypto/credentials";
import { eq, and, inArray, ne } from "drizzle-orm";
import type { WhatsAppAPICredential } from "@/lib/clients/whatsapp-api";
import { downloadWhatsAppAPIMedia } from "@/lib/clients/whatsapp-api";
import { transcribeAudio } from "@/lib/clients/transcrever";
import type { UazAPICredential } from "@/lib/clients/whatsapp-uazapi";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type { AgentReplyPayload } from "@/lib/queue/types";

// GET: verificação do webhook pelo Meta
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return Response.json({ error: "forbidden" }, { status: 403 });
}

async function processInboundMessage(params: {
  organizationId: string;
  from: string;
  body: string;
  messageId: string;
}) {
  const { organizationId, from, body, messageId } = params;

  let thread = await db.query.outreachThreads.findFirst({
    where: and(
      eq(outreachThreads.organizationId, organizationId),
      eq(outreachThreads.externalThreadId, from),
    ),
  });

  if (!thread) {
    const [lead] = await db
      .insert(leads)
      .values({
        organizationId,
        source: "manual",
        externalId: from,
        displayName: from,
        phone: from,
        rawData: { inbound: true },
        qualificationStatus: "pending",
      })
      .onConflictDoNothing()
      .returning({ id: leads.id });

    const leadId = lead?.id ?? (
      await db.query.leads.findFirst({
        where: and(
          eq(leads.organizationId, organizationId),
          eq(leads.externalId, from),
        ),
        columns: { id: true },
      })
    )?.id;

    if (!leadId) return;

    const [newThread] = await db
      .insert(outreachThreads)
      .values({
        organizationId,
        leadId,
        channel: "whatsapp",
        status: "replied",
        externalThreadId: from,
        lastInboundAt: new Date(),
        lastMessageAt: new Date(),
      })
      .returning();

    if (!newThread) return;
    thread = newThread;
  }

  // ON CONFLICT DO NOTHING: se o indice unico parcial (thread_id, external_message_id WHERE direction='inbound')
  // ja existir, o insert e ignorado e returning fica vazio — dedup atomico entre instancias.
  const [inserted] = await db
    .insert(outreachMessages)
    .values({
      organizationId,
      threadId: thread.id,
      direction: "inbound",
      status: "received",
      step: thread.currentStep,
      body,
      externalMessageId: messageId,
    })
    .onConflictDoNothing()
    .returning({ id: outreachMessages.id });

  // Se o insert foi ignorado (duplicata), nao atualiza thread nem enfileira
  if (!inserted) {
    console.log(`[webhook/whatsapp] dedup: messageId ${messageId} ja existia, ignorado`);
    return;
  }

  // Sempre atualiza lastInboundAt e lastMessageAt em qualquer mensagem inbound recebida.
  // Somente muda o status para "replied" se o thread estava ativo ou aguardando resposta.
  // Isso garante que o inbox ordene corretamente mesmo quando o bot ja respondeu e o lead
  // manda outra mensagem (thread em "replied" continuaria estagnado sem este fix).
  const inboundNow = new Date();
  await db
    .update(outreachThreads)
    .set({
      ...(thread.status === "active" || thread.status === "awaiting_reply"
        ? { status: "replied" as const }
        : {}),
      lastInboundAt: inboundNow,
      lastMessageAt: inboundNow,
      updatedAt: inboundNow,
    })
    .where(eq(outreachThreads.id, thread.id));

  const [config] = await db
    .select({ enabled: agentConfigs.enabled })
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, organizationId))
    .limit(1);

  if (config?.enabled) {
    // Verifica opt-out do lead: registra o inbound mas nao enfileira resposta automatica
    const leadRecord = await db.query.leads.findFirst({
      where: eq(leads.id, thread.leadId),
      columns: { doNotDisturb: true },
    });
    if (leadRecord?.doNotDisturb) {
      console.log(`[webhook/whatsapp] lead ${thread.leadId} com doNotDisturb=true, inbound registrado sem resposta automatica`);
      return;
    }

    try {
      const boss = await getBoss();
      const queuePayload: AgentReplyPayload = {
        organizationId,
        threadId: thread.id,
        inboundMessageId: inserted.id,
      };
      await boss.send(QUEUES.agentReply, queuePayload);
    } catch (err) {
      console.error("[webhook/whatsapp] falha ao enfileirar agent.reply", err);
    }
  }
}

// POST: mensagens inbound (Meta Cloud API + UazAPI)
export async function POST(req: NextRequest) {
  // Lê o corpo como texto para permitir validação HMAC depois do org-lookup
  let rawBody: string;
  let body: Record<string, unknown>;
  try {
    rawBody = await req.text();
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: true }, { status: 200 });
  }
  const sigHeader = req.headers.get("x-hub-signature-256") ?? "";

  try {
    // --- Formato UazAPI ---
    if (typeof body.event === "string" && body.data) {
      const data = body.data as {
        from?: string;
        body?: string;
        id?: string;
        type?: string;
      };
      if (data.type === "text" && data.from && data.body) {
        const allUazCreds = await db.query.credentials.findMany({
          where: eq(credentials.provider, "whatsapp_uazapi"),
        });
        for (const row of allUazCreds) {
          try {
            await decryptCredential<UazAPICredential>(row.ciphertext);
            await processInboundMessage({
              organizationId: row.organizationId,
              from: data.from,
              body: data.body,
              messageId: data.id ?? `uazapi-${Date.now()}`,
            });
            break;
          } catch {}
        }
      }
      return Response.json({ ok: true }, { status: 200 });
    }

    // --- Formato Meta Cloud API ---
    const metaBody = body as {
      entry?: {
        changes?: {
          value?: {
            phone_number_id?: string;
            metadata?: { phone_number_id?: string };
            messages?: {
              id: string;
              from: string;
              text?: { body: string };
              audio?: { id: string };
              type: string;
            }[];
            statuses?: {
              id: string;
              status: string;
              recipient_id?: string;
              errors?: { title?: string; message?: string }[];
            }[];
          };
        }[];
      }[];
    };

    const value = metaBody.entry?.[0]?.changes?.[0]?.value;

    // Confirmacoes de entrega da Meta vem em value.statuses (NAO em messages).
    // Sem processar isso, toda mensagem enviada ficava eternamente "sent" (em
    // transito). Atualiza o status da outreach_message pelo external_message_id,
    // sem regredir (delivered nao volta pra sent).
    const statuses = value?.statuses;
    if (statuses?.length) {
      for (const st of statuses) {
        if (!st.id || !st.status) continue;
        if (st.status === "delivered" || st.status === "read") {
          await db
            .update(outreachMessages)
            .set({ status: "delivered", updatedAt: new Date() })
            .where(
              and(
                eq(outreachMessages.externalMessageId, st.id),
                inArray(outreachMessages.status, ["pending", "sent"]),
              ),
            );
        } else if (st.status === "failed") {
          await db
            .update(outreachMessages)
            .set({
              status: "failed",
              errorReason: st.errors?.[0]?.title ?? "falha na entrega (WhatsApp)",
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(outreachMessages.externalMessageId, st.id),
                ne(outreachMessages.status, "delivered"),
              ),
            );
        } else if (st.status === "sent") {
          await db
            .update(outreachMessages)
            .set({ status: "sent", updatedAt: new Date() })
            .where(
              and(
                eq(outreachMessages.externalMessageId, st.id),
                eq(outreachMessages.status, "pending"),
              ),
            );
        }
      }
      return Response.json({ ok: true }, { status: 200 });
    }
    if (!value?.messages?.length) {
      return Response.json({ ok: true }, { status: 200 });
    }

    const phoneNumberId = value.metadata?.phone_number_id ?? value.phone_number_id;
    const msg = value.messages[0];
    if (!msg) {
      return Response.json({ ok: true }, { status: 200 });
    }

    // Identifica a org pela credencial whatsapp_api com esse phone_number_id
    const allApiCreds = await db.query.credentials.findMany({
      where: eq(credentials.provider, "whatsapp_api"),
    });
    let orgId: string | null = null;
    let orgAppSecret: string | null = null;
    for (const row of allApiCreds) {
      try {
        const cred = await decryptCredential<WhatsAppAPICredential>(row.ciphertext);
        if (cred.phone_number_id === phoneNumberId) {
          orgId = row.organizationId;
          orgAppSecret = cred.app_secret ?? null;
          break;
        }
      } catch {}
    }
    if (!orgId) {
      return Response.json({ ok: true }, { status: 200 });
    }

    // Validacao HMAC opcional: se app_secret configurado, verifica X-Hub-Signature-256.
    // Nao bloqueia em caso de falha (backward compat), apenas loga aviso.
    if (sigHeader && orgAppSecret) {
      const { createHmac } = await import("node:crypto");
      const expected = "sha256=" + createHmac("sha256", orgAppSecret).update(rawBody).digest("hex");
      if (sigHeader !== expected) {
        console.warn("[webhook/whatsapp] assinatura HMAC invalida para org", orgId);
      }
    }

    // Extrai o conteudo: texto direto ou audio transcrito (faster-whisper)
    let messageBody: string | null = null;
    if (msg.type === "text" && msg.text?.body) {
      messageBody = msg.text.body;
    } else if (msg.type === "audio" && msg.audio?.id) {
      const media = await downloadWhatsAppAPIMedia(orgId, msg.audio.id);
      if (media) {
        messageBody = await transcribeAudio(media.bytes, media.mimeType);
      }
    }
    if (!messageBody) {
      return Response.json({ ok: true }, { status: 200 });
    }

    await processInboundMessage({
      organizationId: orgId,
      from: msg.from,
      body: messageBody,
      messageId: msg.id,
    });
  } catch (err) {
    console.error("[webhook/whatsapp] erro:", err);
  }

  return Response.json({ ok: true }, { status: 200 });
}
