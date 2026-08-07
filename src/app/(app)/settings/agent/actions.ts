"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { agentConfigs } from "@/db/schema/agent";
import { requireOrg } from "@/lib/auth/guards";

const schema = z.object({
  enabled: z.boolean(),
  agentName: z.string().min(1).max(80).default("Isabela"),
  businessName: z.string().max(200).optional().nullable(),
  businessInfo: z.string().max(20000).optional().nullable(),
  tone: z.string().max(200),
  systemPromptOverride: z.string().max(20000).optional().nullable(),
  rules: z.array(z.string().min(1).max(400)).max(30),
  handoffKeywords: z.array(z.string().min(1).max(80)).max(30),
  maxAutoReplies: z.coerce.number().int().min(1).max(30),
  model: z.string().max(100),
  followUpModel: z.string().max(100).optional().nullable(),
  knowledgeModel: z.string().max(100).optional().nullable(),
  temperature: z.coerce.number().int().min(0).max(100),
});

export async function saveAgentConfig(input: z.infer<typeof schema>) {
  const { organizationId } = await requireOrg();
  const parsed = schema.parse(input);

  const existing = await db
    .select({ id: agentConfigs.id })
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, organizationId))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(agentConfigs).values({
      organizationId,
      enabled: parsed.enabled,
      agentName: parsed.agentName,
      businessName: parsed.businessName ?? null,
      businessInfo: parsed.businessInfo ?? null,
      tone: parsed.tone,
      systemPromptOverride: parsed.systemPromptOverride ?? null,
      rules: parsed.rules,
      handoffKeywords: parsed.handoffKeywords,
      maxAutoReplies: parsed.maxAutoReplies,
      model: parsed.model,
      followUpModel: parsed.followUpModel ?? null,
      knowledgeModel: parsed.knowledgeModel ?? null,
      temperature: parsed.temperature,
    });
  } else {
    await db
      .update(agentConfigs)
      .set({
        enabled: parsed.enabled,
        agentName: parsed.agentName,
        businessName: parsed.businessName ?? null,
        businessInfo: parsed.businessInfo ?? null,
        tone: parsed.tone,
        systemPromptOverride: parsed.systemPromptOverride ?? null,
        rules: parsed.rules,
        handoffKeywords: parsed.handoffKeywords,
        maxAutoReplies: parsed.maxAutoReplies,
        model: parsed.model,
        followUpModel: parsed.followUpModel ?? null,
        knowledgeModel: parsed.knowledgeModel ?? null,
        temperature: parsed.temperature,
        updatedAt: new Date(),
      })
      .where(eq(agentConfigs.organizationId, organizationId));
  }

  revalidatePath("/settings/agent");
  return { ok: true as const };
}
