"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { leads } from "@/db/schema/leads";
import { requireOrg } from "@/lib/auth/guards";

const rowSchema = z.object({
  displayName: z.string().min(1).max(240),
  handle: z.string().max(240).optional().nullable(),
  email: z.string().email().max(240).optional().nullable(),
  phone: z.string().max(120).optional().nullable(),
  website: z.string().max(500).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  region: z.string().max(120).optional().nullable(),
  country: z.string().max(120).optional().nullable(),
  linkedinUrl: z.string().max(500).optional().nullable(),
  headline: z.string().max(500).optional().nullable(),
  company: z.string().max(240).optional().nullable(),
});

const payloadSchema = z.object({
  campaignId: z.string().uuid().nullable().optional(),
  rows: z.array(rowSchema).min(1).max(5000),
});

export type ImportPayload = z.infer<typeof payloadSchema>;

export async function importLeadsFromCsv(input: ImportPayload) {
  const { organizationId } = await requireOrg();
  const parsed = payloadSchema.parse(input);

  const now = new Date();
  const values = parsed.rows.map((r, idx) => ({
    organizationId,
    miningId: parsed.campaignId ?? null,
    source: "manual" as const,
    externalId: `import-${now.getTime()}-${idx}`,
    displayName: r.displayName,
    handle: r.handle ?? null,
    website: r.website ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    city: r.city ?? null,
    region: r.region ?? null,
    country: r.country ?? null,
    linkedinUrl: r.linkedinUrl ?? null,
    headline: r.headline ?? null,
    company: r.company ?? null,
    rawData: { importedAt: now.toISOString(), original: r } as Record<string, unknown>,
    qualificationStatus: "pending" as const,
  }));

  const inserted = await db
    .insert(leads)
    .values(values)
    .onConflictDoNothing({
      target: [leads.organizationId, leads.source, leads.externalId],
    })
    .returning({ id: leads.id });

  revalidatePath("/leads");

  return { ok: true as const, inserted: inserted.length, total: values.length };
}
