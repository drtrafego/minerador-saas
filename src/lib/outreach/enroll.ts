import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { leads } from "@/db/schema/leads";
import { outreachCampaigns, campaignLeads } from "@/db/schema/outreach-campaigns";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type { CampaignSendPayload } from "@/lib/queue/types";

// External ref estavel por lead: dedup atomico no indice unico
// (outreach_campaign_id, external_ref) da tabela campaign_leads.
export function leadExternalRef(leadId: string): string {
  return createHash("sha1").update(leadId).digest("hex");
}

export type EnrollLeadsResult = {
  enfileirados: number;
  puladosOptOut: number;
  puladosDedupe: number;
};

/**
 * Nucleo reutilizavel de "ligar leads a uma campanha de abordagem": insere
 * campaign_leads (dedup por outreach_campaign_id+external_ref via
 * ON CONFLICT DO NOTHING) e enfileira o primeiro toque (campaign.send) com
 * espacamento humano crescente (jitter entre sendIntervalMinSeconds e
 * sendIntervalMaxSeconds da propria campanha).
 *
 * Pula leads inexistentes/deletados/de outra org (puladosDedupe) e leads com
 * opt-out (puladosOptOut). NAO valida se a campanha existe/esta ativa: isso
 * e responsabilidade do chamador (acao de UI, planner da automacao).
 */
export async function enrollLeadsIntoCampaign(input: {
  organizationId: string;
  campaignId: string;
  leadIds: string[];
  startAfterOffsetSeconds?: number;
}): Promise<EnrollLeadsResult> {
  const { organizationId, campaignId } = input;

  const uniqueLeadIds = Array.from(new Set(input.leadIds));
  if (uniqueLeadIds.length === 0) {
    return { enfileirados: 0, puladosOptOut: 0, puladosDedupe: 0 };
  }

  const [camp] = await db
    .select({
      id: outreachCampaigns.id,
      sendIntervalMinSeconds: outreachCampaigns.sendIntervalMinSeconds,
      sendIntervalMaxSeconds: outreachCampaigns.sendIntervalMaxSeconds,
    })
    .from(outreachCampaigns)
    .where(
      and(
        eq(outreachCampaigns.id, campaignId),
        eq(outreachCampaigns.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!camp) {
    throw new Error(`campanha de abordagem ${campaignId} nao encontrada`);
  }

  const leadsRows = await db
    .select({ id: leads.id, doNotDisturb: leads.doNotDisturb })
    .from(leads)
    .where(
      and(
        eq(leads.organizationId, organizationId),
        inArray(leads.id, uniqueLeadIds),
        isNull(leads.deletedAt),
      ),
    );
  const leadById = new Map(leadsRows.map((l) => [l.id, l]));

  const boss = await getBoss();

  let enfileirados = 0;
  let puladosOptOut = 0;
  let puladosDedupe = 0;

  // Espacamento humano entre os primeiros toques: usa os intervalos da campanha.
  const minInt = Math.max(0, camp.sendIntervalMinSeconds);
  const maxInt = Math.max(minInt, camp.sendIntervalMaxSeconds);
  let offsetSeg = Math.max(0, input.startAfterOffsetSeconds ?? 0);

  for (const leadId of uniqueLeadIds) {
    const lead = leadById.get(leadId);
    if (!lead) {
      puladosDedupe++;
      continue;
    }
    if (lead.doNotDisturb) {
      puladosOptOut++;
      continue;
    }

    const [created] = await db
      .insert(campaignLeads)
      .values({
        organizationId,
        outreachCampaignId: campaignId,
        leadId,
        externalRef: leadExternalRef(leadId),
        status: "enqueued",
        step: 0,
      })
      .onConflictDoNothing({
        target: [campaignLeads.outreachCampaignId, campaignLeads.externalRef],
      })
      .returning({ id: campaignLeads.id });

    if (!created) {
      puladosDedupe++;
      continue;
    }

    const payload: CampaignSendPayload = { campaignLeadId: created.id };
    await boss.send(QUEUES.campaignSend, payload, { startAfter: offsetSeg });

    offsetSeg += minInt + Math.floor(Math.random() * (maxInt - minInt + 1));
    enfileirados++;
  }

  return { enfileirados, puladosOptOut, puladosDedupe };
}
