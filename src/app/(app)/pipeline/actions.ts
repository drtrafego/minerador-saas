"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { leads } from "@/db/schema/leads";
import { pipelineStages, activities } from "@/db/schema/pipeline";
import { requireOrg } from "@/lib/auth/guards";

const moveSchema = z.object({
  leadId: z.string().uuid(),
  stageId: z.string().uuid().nullable(),
});

export async function moveLeadToStage(input: z.infer<typeof moveSchema>) {
  const { organizationId } = await requireOrg();
  const parsed = moveSchema.parse(input);

  if (parsed.stageId) {
    const stage = await db
      .select({ id: pipelineStages.id })
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.id, parsed.stageId),
          eq(pipelineStages.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (stage.length === 0) {
      throw new Error("stage nao encontrado");
    }
  }

  await db
    .update(leads)
    .set({ pipelineStageId: parsed.stageId, updatedAt: new Date() })
    .where(and(eq(leads.id, parsed.leadId), eq(leads.organizationId, organizationId)));

  revalidatePath("/pipeline");
}

const temperatureSchema = z.object({
  leadId: z.string().uuid(),
  temperature: z.enum(["cold", "warm", "hot"]).nullable(),
});

export async function setLeadTemperature(input: z.infer<typeof temperatureSchema>) {
  const { organizationId } = await requireOrg();
  const parsed = temperatureSchema.parse(input);

  await db
    .update(leads)
    .set({ temperature: parsed.temperature, updatedAt: new Date() })
    .where(and(eq(leads.id, parsed.leadId), eq(leads.organizationId, organizationId)));

  revalidatePath("/pipeline");
  revalidatePath(`/leads/${parsed.leadId}`);
}

const activitySchema = z.object({
  leadId: z.string().uuid(),
  type: z.enum(["note", "call", "email", "meeting", "whatsapp", "task"]),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  dueAt: z.string().datetime().optional().nullable(),
});

export async function createActivity(input: z.infer<typeof activitySchema>) {
  const { organizationId, user } = await requireOrg();
  const parsed = activitySchema.parse(input);

  const leadRow = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, parsed.leadId), eq(leads.organizationId, organizationId)))
    .limit(1);
  if (leadRow.length === 0) {
    throw new Error("lead nao encontrado");
  }

  await db.insert(activities).values({
    organizationId,
    leadId: parsed.leadId,
    type: parsed.type,
    title: parsed.title,
    description: parsed.description ?? null,
    dueAt: parsed.dueAt ? new Date(parsed.dueAt) : null,
    createdByUserId: user.id,
  });

  revalidatePath(`/leads/${parsed.leadId}`);
  revalidatePath("/pipeline");
}

const completeActivitySchema = z.object({
  activityId: z.string().uuid(),
  leadId: z.string().uuid(),
});

export async function toggleActivityComplete(input: z.infer<typeof completeActivitySchema>) {
  const { organizationId } = await requireOrg();
  const parsed = completeActivitySchema.parse(input);

  const row = await db
    .select({ completedAt: activities.completedAt })
    .from(activities)
    .where(and(eq(activities.id, parsed.activityId), eq(activities.organizationId, organizationId)))
    .limit(1);
  if (row.length === 0) return;

  await db
    .update(activities)
    .set({
      completedAt: row[0].completedAt ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(activities.id, parsed.activityId));

  revalidatePath(`/leads/${parsed.leadId}`);
}

const stageSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#64748b"),
  position: z.coerce.number().int().min(0).max(100),
});

export async function createPipelineStage(input: z.infer<typeof stageSchema>) {
  const { organizationId } = await requireOrg();
  const parsed = stageSchema.parse(input);
  await db.insert(pipelineStages).values({
    organizationId,
    name: parsed.name,
    color: parsed.color,
    position: parsed.position,
  });
  revalidatePath("/pipeline");
}

const deleteStageSchema = z.object({ stageId: z.string().uuid() });

export async function deletePipelineStage(input: z.infer<typeof deleteStageSchema>) {
  const { organizationId } = await requireOrg();
  const parsed = deleteStageSchema.parse(input);

  await db
    .update(leads)
    .set({ pipelineStageId: null, updatedAt: new Date() })
    .where(and(eq(leads.pipelineStageId, parsed.stageId), eq(leads.organizationId, organizationId)));

  await db
    .delete(pipelineStages)
    .where(and(eq(pipelineStages.id, parsed.stageId), eq(pipelineStages.organizationId, organizationId)));

  revalidatePath("/pipeline");
}
