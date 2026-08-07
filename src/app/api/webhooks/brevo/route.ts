import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { outreachMessages } from "@/db/schema/outreach";
import { events } from "@/db/schema/events";
import { mapBrevoEvent } from "@/lib/outreach/brevo-status";

export const runtime = "nodejs";

// Ranqueamento para garantir que o status so avanca.
// O enum deste projeto possui: pending < sent < delivered.
// "failed" e terminal e tratado separadamente.
// "received" e exclusivo de mensagens inbound e nao entra neste fluxo.
const STATUS_RANK: Record<string, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
};

function shouldAdvance(current: string, next: string): boolean {
  // Status terminal nunca e reescrito, independentemente do proximo evento.
  // Esta guarda precisa vir ANTES da checagem de next==="failed", caso contrario
  // um segundo evento de falha (ex: hard_bounce apos blocked) reescreveria o
  // errorReason original, pois "failed" nao esta em STATUS_RANK e o fallback
  // ?? 0 faria a comparacao <= STATUS_RANK.sent passar.
  if (current === "failed") return false;
  if (next === "failed") {
    // Falha so pode sobrescrever pending ou sent; nao reverte um delivered.
    return (STATUS_RANK[current] ?? 0) <= STATUS_RANK.sent;
  }
  return (STATUS_RANK[next] ?? 0) > (STATUS_RANK[current] ?? 0);
}

// Comparacao em tempo constante para evitar timing attacks.
// Retorna false quando os comprimentos diferem sem acionar o timingSafeEqual
// (que exigiria buffers de mesmo tamanho).
function comparacaoSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Token de validacao pode chegar via header "x-webhook-token" (padrao Brevo),
// via "Authorization" (com ou sem prefixo Bearer) ou via query param "token".
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

const eventoSchema = z
  .object({
    event: z.string().min(1),
    "message-id": z.string().min(1),
    reason: z.string().nullish(),
    email: z.string().nullish(),
  })
  .passthrough();

// Busca a mensagem pelo externalMessageId.
// O Brevo pode enviar o id com ou sem os angulares < >, entao tentamos ambas as formas.
async function buscarMensagem(messageId: string) {
  const exato = await db
    .select({
      id: outreachMessages.id,
      organizationId: outreachMessages.organizationId,
      status: outreachMessages.status,
    })
    .from(outreachMessages)
    .where(eq(outreachMessages.externalMessageId, messageId))
    .limit(1);
  if (exato[0]) return exato[0];

  const variante =
    messageId.startsWith("<") && messageId.endsWith(">")
      ? messageId.slice(1, -1)
      : `<${messageId}>`;

  const alt = await db
    .select({
      id: outreachMessages.id,
      organizationId: outreachMessages.organizationId,
      status: outreachMessages.status,
    })
    .from(outreachMessages)
    .where(eq(outreachMessages.externalMessageId, variante))
    .limit(1);
  return alt[0] ?? null;
}

export async function POST(req: NextRequest) {
  if (!tokenValido(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = eventoSchema.safeParse(json);
  if (!parsed.success) {
    // 200 de proposito: payload nao reconhecido nao deve fazer o Brevo reenviar.
    return NextResponse.json({ skipped: "ignored" }, { status: 200 });
  }

  const event = parsed.data.event;
  const messageId = parsed.data["message-id"];
  const reason = parsed.data.reason ?? null;

  const message = await buscarMensagem(messageId);
  if (!message) {
    console.log(`[webhook/brevo] mensagem nao encontrada: messageId=${messageId}`);
    return NextResponse.json({ skipped: "not_found" }, { status: 200 });
  }

  const now = new Date();
  const mapped = mapBrevoEvent(event, reason);

  // Eventos sem impacto no status da mensagem (spam, descadastro e ignorados).
  if (mapped.status === null) {
    if (event === "spam" || event === "unsubscribed") {
      await db.insert(events).values({
        organizationId: message.organizationId,
        type: "email.status",
        entityType: "outreach_message",
        entityId: message.id,
        data: {
          event,
          messageId,
          label: mapped.label,
          source: "brevo-webhook",
        },
      });
    }
    return NextResponse.json({ ok: true });
  }

  // Idempotencia: so avanca se o novo status for superior ao atual.
  if (!shouldAdvance(message.status, mapped.status)) {
    return NextResponse.json({ ok: true, skipped: "no_advance" });
  }

  if (mapped.status !== "failed") {
    await db
      .update(outreachMessages)
      .set({ status: mapped.status, updatedAt: now })
      .where(
        and(
          eq(outreachMessages.id, message.id),
          eq(outreachMessages.organizationId, message.organizationId),
        ),
      );

    await db.insert(events).values({
      organizationId: message.organizationId,
      type: "email.status",
      entityType: "outreach_message",
      entityId: message.id,
      data: {
        event,
        messageId,
        status: mapped.status,
        label: mapped.label,
        source: "brevo-webhook",
      },
    });

    return NextResponse.json({ ok: true });
  }

  // status === "failed": atualiza status e errorReason.
  await db
    .update(outreachMessages)
    .set({ status: "failed", errorReason: mapped.label, updatedAt: now })
    .where(
      and(
        eq(outreachMessages.id, message.id),
        eq(outreachMessages.organizationId, message.organizationId),
      ),
    );

  await db.insert(events).values({
    organizationId: message.organizationId,
    type: "email.status",
    entityType: "outreach_message",
    entityId: message.id,
    data: {
      event,
      messageId,
      status: "failed",
      label: mapped.label,
      reason,
      source: "brevo-webhook",
    },
  });

  return NextResponse.json({ ok: true });
}
