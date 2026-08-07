"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads } from "@/db/schema/leads";
import { requireOrg } from "@/lib/auth/guards";

/**
 * Marca (ou desmarca) leads como "nao perturbe" (do_not_disturb). Um lead assim
 * NUNCA e abordado: o disparo pula (dispararLeadsParaOutreachCampaign / enroll) e
 * o bot inbound nao responde. Usado para bloquear clientes proprios que aparecem
 * na mineracao.
 */
export async function setLeadsDoNotDisturb(leadIds: string[], value: boolean) {
  const { organizationId } = await requireOrg();
  if (leadIds.length === 0) return { error: "nenhum lead selecionado" };

  await db
    .update(leads)
    .set({ doNotDisturb: value, updatedAt: new Date() })
    .where(
      and(
        eq(leads.organizationId, organizationId),
        inArray(leads.id, leadIds),
      ),
    );

  revalidatePath("/leads");
  return { ok: true as const, count: leadIds.length };
}
