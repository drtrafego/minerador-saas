"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { leads } from "@/db/schema/leads";
import { requireOrg } from "@/lib/auth/guards";

export async function approveLead(leadId: string, campaignId: string) {
  const { organizationId } = await requireOrg();
  await db
    .update(leads)
    .set({
      qualificationStatus: "qualified",
      qualifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)),
    );
  revalidatePath(`/mining/${campaignId}/leads`);
  revalidatePath("/leads");
  return { ok: true };
}

export async function rejectLead(
  leadId: string,
  campaignId: string,
  reason?: string,
) {
  const { organizationId } = await requireOrg();
  await db
    .update(leads)
    .set({
      qualificationStatus: "disqualified",
      qualificationReason: reason ?? "rejeitado manualmente",
      qualifiedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)),
    );
  revalidatePath(`/mining/${campaignId}/leads`);
  revalidatePath("/leads");
  return { ok: true };
}
