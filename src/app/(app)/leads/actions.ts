"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { outreachCampaigns } from "@/db/schema/outreach-campaigns";
import { enrollLeadsIntoCampaign } from "@/lib/outreach/enroll";

export type DispararOutreachState = {
  ok: boolean;
  message: string;
  enfileirados?: number;
  puladosOptOut?: number;
  puladosDedupe?: number;
};

/**
 * Liga leads a uma campanha de abordagem existente (outreach_campaigns),
 * criando registros em campaign_leads e enfileirando o primeiro toque na fila
 * campaign.send.
 *
 * Dedup por (outreach_campaign_id, external_ref) com ON CONFLICT DO NOTHING.
 * Pula leads com opt-out (do_not_disturb) e leads inexistentes/deletados.
 */
export async function dispararLeadsParaOutreachCampaign(input: {
  outreachCampaignId: string;
  leadIds: string[];
}): Promise<DispararOutreachState> {
  const { organizationId } = await requireOrg();

  const outreachCampaignId = String(input.outreachCampaignId ?? "").trim();
  if (!outreachCampaignId) {
    return { ok: false, message: "Selecione uma campanha de abordagem." };
  }

  const leadIds = Array.isArray(input.leadIds)
    ? Array.from(
        new Set(input.leadIds.filter((v): v is string => typeof v === "string")),
      )
    : [];

  if (leadIds.length === 0) {
    return { ok: false, message: "Nenhum lead selecionado." };
  }
  if (leadIds.length > 1000) {
    return { ok: false, message: "Selecione no maximo 1000 leads por disparo." };
  }

  // Valida a campanha de abordagem e garante pertencer a org.
  const [camp] = await db
    .select({
      id: outreachCampaigns.id,
      active: outreachCampaigns.active,
    })
    .from(outreachCampaigns)
    .where(
      and(
        eq(outreachCampaigns.id, outreachCampaignId),
        eq(outreachCampaigns.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!camp) {
    return { ok: false, message: "Campanha de abordagem nao encontrada." };
  }
  if (!camp.active) {
    return { ok: false, message: "Ative a campanha de abordagem antes de disparar." };
  }

  const { enfileirados, puladosOptOut, puladosDedupe } =
    await enrollLeadsIntoCampaign({
      organizationId,
      campaignId: outreachCampaignId,
      leadIds,
    });

  revalidatePath("/leads");
  revalidatePath("/outreach");
  revalidatePath(`/outreach/${outreachCampaignId}`);

  const partes: string[] = [`${enfileirados} enfileirados`];
  if (puladosOptOut > 0) partes.push(`${puladosOptOut} opt-out`);
  if (puladosDedupe > 0) partes.push(`${puladosDedupe} ja na campanha`);

  return {
    ok: enfileirados > 0,
    message: partes.join(", ") + ".",
    enfileirados,
    puladosOptOut,
    puladosDedupe,
  };
}
