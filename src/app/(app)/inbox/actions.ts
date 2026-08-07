"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { outreachThreads, outreachMessages } from "@/db/schema/outreach";
import { leads } from "@/db/schema/leads";
import { requireOrg } from "@/lib/auth/guards";
import {
  loadUazAPICredential,
  sendUazAPIMessage,
  UazAPINotConfiguredError,
  UazAPIError,
} from "@/lib/clients/whatsapp-uazapi";
import {
  loadWhatsAppAPICredential,
  sendWhatsAppAPIMessage,
  WhatsAppAPINotConfiguredError,
  WhatsAppAPIError,
} from "@/lib/clients/whatsapp-api";

export async function sendManualMessage(threadId: string, body: string) {
  const { organizationId } = await requireOrg();
  if (!body.trim()) return { error: "mensagem vazia" };

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
  if (!thread) return { error: "thread nao encontrada" };

  const [lead] = await db
    .select({ phone: leads.phone })
    .from(leads)
    .where(
      and(
        eq(leads.id, thread.leadId),
        isNull(leads.deletedAt),
      ),
    )
    .limit(1);
  if (!lead) return { error: "lead nao encontrado ou excluido" };
  if (!lead.phone) return { error: "lead sem telefone" };

  let sent: { messageId: string; provider: string } | null = null;

  try {
    const cred = await loadUazAPICredential(organizationId);
    if (cred) {
      const res = await sendUazAPIMessage({
        organizationId,
        phone: lead.phone,
        body: body.trim(),
      });
      sent = { messageId: res.messageId, provider: "uazapi" };
    }
  } catch (err) {
    if (
      !(err instanceof UazAPINotConfiguredError) &&
      !(err instanceof UazAPIError)
    ) {
      throw err;
    }
  }

  if (!sent) {
    try {
      const cred = await loadWhatsAppAPICredential(organizationId);
      if (cred) {
        const res = await sendWhatsAppAPIMessage({
          organizationId,
          phone: lead.phone,
          body: body.trim(),
        });
        sent = { messageId: res.messageId, provider: "meta" };
      }
    } catch (err) {
      if (
        !(err instanceof WhatsAppAPINotConfiguredError) &&
        !(err instanceof WhatsAppAPIError)
      ) {
        throw err;
      }
    }
  }

  if (!sent) return { error: "nenhum provider WhatsApp configurado" };

  const now = new Date();
  await db.insert(outreachMessages).values({
    organizationId,
    threadId,
    direction: "outbound",
    status: "sent",
    step: thread.currentStep,
    body: body.trim(),
    externalMessageId: sent.messageId,
    sentAt: now,
    metadata: { manual: true, provider: sent.provider },
  });

  await db
    .update(outreachThreads)
    .set({ lastMessageAt: now, lastOutboundAt: now, updatedAt: now })
    .where(eq(outreachThreads.id, threadId));

  revalidatePath(`/inbox/${threadId}`);
  return { ok: true };
}

export async function toggleBotPause(threadId: string, paused: boolean) {
  const { organizationId } = await requireOrg();

  await db
    .update(outreachThreads)
    .set({ botPaused: paused, updatedAt: new Date() })
    .where(
      and(
        eq(outreachThreads.id, threadId),
        eq(outreachThreads.organizationId, organizationId),
      ),
    );

  revalidatePath(`/inbox/${threadId}`);
  revalidatePath("/inbox");
  return { ok: true };
}
