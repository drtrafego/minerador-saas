"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import {
  automationConfig,
  channelWarmup,
} from "@/db/schema/outreach-automation";
import { requireOrg } from "@/lib/auth/guards";

const rotationComboSchema = z.object({
  niche: z.string().min(1).max(200),
  city: z.string().max(200).optional().nullable(),
  sourceType: z.enum([
    "google_places",
    "instagram_hashtag",
    "linkedin_search",
  ]),
});

const nicheRoutingSchema = z.object({
  niche: z.string().min(1).max(200),
  channel: z.enum(["whatsapp", "email"]),
  campaignId: z.string().uuid(),
});

const configSchema = z.object({
  miningEnabled: z.boolean(),
  rotationCombos: z.array(rotationComboSchema).max(50),
  nicheRouting: z.array(nicheRoutingSchema).max(50),
  dispatchMode: z.enum(["auto", "approval"]),
  whatsappCampaignId: z.string().uuid().optional().nullable(),
  emailCampaignId: z.string().uuid().optional().nullable(),
  blocklist: z.array(z.string().min(1).max(200)).max(200),
});

export async function salvarAutomationConfig(input: z.infer<typeof configSchema>) {
  const { organizationId } = await requireOrg();
  const parsed = configSchema.parse(input);

  const combos = parsed.rotationCombos.map((c) => ({
    niche: c.niche.trim(),
    ...(c.city && c.city.trim() ? { city: c.city.trim() } : {}),
    sourceType: c.sourceType,
  }));

  const nicheRouting = parsed.nicheRouting.map((r) => ({
    niche: r.niche.trim(),
    channel: r.channel,
    campaignId: r.campaignId,
  }));

  const values = {
    miningEnabled: parsed.miningEnabled,
    rotationCombos: combos,
    nicheRouting,
    dispatchMode: parsed.dispatchMode,
    whatsappCampaignId: parsed.whatsappCampaignId ?? null,
    emailCampaignId: parsed.emailCampaignId ?? null,
    blocklist: parsed.blocklist.map((b) => b.trim()).filter(Boolean),
  };

  const existing = await db
    .select({ id: automationConfig.id })
    .from(automationConfig)
    .where(eq(automationConfig.organizationId, organizationId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(automationConfig).values({ organizationId, ...values });
  } else {
    await db
      .update(automationConfig)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(automationConfig.organizationId, organizationId));
  }

  revalidatePath("/settings/automation");
  return { ok: true as const };
}

const warmupSchema = z.object({
  channel: z.enum(["whatsapp", "email"]),
  enabled: z.boolean(),
  startedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data invalida"),
});

export async function salvarChannelWarmup(input: z.infer<typeof warmupSchema>) {
  const { organizationId } = await requireOrg();
  const parsed = warmupSchema.parse(input);

  const existing = await db
    .select({ id: channelWarmup.id })
    .from(channelWarmup)
    .where(
      and(
        eq(channelWarmup.organizationId, organizationId),
        eq(channelWarmup.channel, parsed.channel),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(channelWarmup).values({
      organizationId,
      channel: parsed.channel,
      enabled: parsed.enabled,
      startedAt: parsed.startedAt,
    });
  } else {
    await db
      .update(channelWarmup)
      .set({
        enabled: parsed.enabled,
        startedAt: parsed.startedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(channelWarmup.organizationId, organizationId),
          eq(channelWarmup.channel, parsed.channel),
        ),
      );
  }

  revalidatePath("/settings/automation");
  return { ok: true as const };
}
