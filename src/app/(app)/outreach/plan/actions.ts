"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  automationConfig,
  dailySendPlan,
  dailySendPlanItem,
} from "@/db/schema/outreach-automation";
import { requireOrg } from "@/lib/auth/guards";
import { enrollLeadsIntoCampaign } from "@/lib/outreach/enroll";

const idSchema = z.object({ planId: z.string().uuid() });

async function loadPendingPlan(organizationId: string, planId: string) {
  const [plan] = await db
    .select()
    .from(dailySendPlan)
    .where(
      and(
        eq(dailySendPlan.id, planId),
        eq(dailySendPlan.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!plan) throw new Error("plano nao encontrado");
  if (plan.status !== "pending") throw new Error("plano nao esta pendente");
  return plan;
}

export async function aprovarPlanoDiario(input: z.infer<typeof idSchema>) {
  const { organizationId } = await requireOrg();
  const { planId } = idSchema.parse(input);

  const plan = await loadPendingPlan(organizationId, planId);

  // Fallback de campanha do canal, para itens antigos sem campanha propria.
  let fallbackCampaignId = plan.outreachCampaignId;
  if (!fallbackCampaignId) {
    const [config] = await db
      .select({
        whatsappCampaignId: automationConfig.whatsappCampaignId,
        emailCampaignId: automationConfig.emailCampaignId,
      })
      .from(automationConfig)
      .where(eq(automationConfig.organizationId, organizationId))
      .limit(1);
    fallbackCampaignId =
      plan.channel === "whatsapp"
        ? config?.whatsappCampaignId ?? null
        : plan.channel === "email"
          ? config?.emailCampaignId ?? null
          : null;
  }

  const items = await db
    .select({
      leadId: dailySendPlanItem.leadId,
      outreachCampaignId: dailySendPlanItem.outreachCampaignId,
    })
    .from(dailySendPlanItem)
    .where(eq(dailySendPlanItem.planId, planId));

  // Agrupa por campanha (cada nicho tem a sua). Itens sem campanha propria
  // caem no fallback do canal; se nem isso houver, o plano nao tem para onde ir.
  const porCampanha = new Map<string, string[]>();
  for (const it of items) {
    const campaignId = it.outreachCampaignId ?? fallbackCampaignId;
    if (!campaignId) continue;
    const arr = porCampanha.get(campaignId) ?? [];
    arr.push(it.leadId);
    porCampanha.set(campaignId, arr);
  }

  if (porCampanha.size === 0) {
    throw new Error(
      "nenhuma campanha de abordagem definida para este plano. Configure o roteamento por nicho em Automação.",
    );
  }

  const total = { enfileirados: 0, puladosOptOut: 0, puladosDedupe: 0 };
  for (const [campaignId, leadIds] of porCampanha) {
    const result = await enrollLeadsIntoCampaign({
      organizationId,
      campaignId,
      leadIds,
    });
    total.enfileirados += result.enfileirados;
    total.puladosOptOut += result.puladosOptOut;
    total.puladosDedupe += result.puladosDedupe;
  }

  await db
    .update(dailySendPlan)
    .set({ status: "approved", decidedAt: new Date() })
    .where(eq(dailySendPlan.id, planId));

  await db
    .update(dailySendPlanItem)
    .set({ status: "sent" })
    .where(eq(dailySendPlanItem.planId, planId));

  revalidatePath("/outreach/plan");
  return { ok: true as const, ...total };
}

export async function rejeitarPlanoDiario(input: z.infer<typeof idSchema>) {
  const { organizationId } = await requireOrg();
  const { planId } = idSchema.parse(input);

  await loadPendingPlan(organizationId, planId);

  await db
    .update(dailySendPlan)
    .set({ status: "rejected", decidedAt: new Date() })
    .where(eq(dailySendPlan.id, planId));

  revalidatePath("/outreach/plan");
  return { ok: true as const };
}
