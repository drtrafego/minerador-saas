"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { outreachCampaigns } from "@/db/schema/outreach-campaigns";
import { requireOrg } from "@/lib/auth/guards";
import { getOrgCredential, MissingCredentialError } from "@/lib/credentials/get";
import {
  listarTemplatesMeta,
  type MetaTemplate,
} from "@/lib/clients/meta-templates";
import { serializeTemplateVars } from "@/lib/utils/template-vars";

const channelSchema = z.enum([
  "email",
  "whatsapp",
  "instagram_dm",
  "linkedin_dm",
]);

// Lista os templates APROVADOS da WABA da org (credencial whatsapp_api).
export type ListMetaTemplatesResult = {
  available: boolean;
  error?: string;
  templates: MetaTemplate[];
};

export async function listApprovedMetaTemplates(): Promise<ListMetaTemplatesResult> {
  const { organizationId } = await requireOrg();

  let cred: Awaited<ReturnType<typeof getOrgCredential<"whatsapp_api">>>;
  try {
    cred = await getOrgCredential(organizationId, "whatsapp_api");
  } catch (err) {
    if (err instanceof MissingCredentialError) {
      return { available: false, templates: [] };
    }
    return { available: false, templates: [], error: String(err) };
  }

  if (!cred.waba_id) {
    return {
      available: false,
      templates: [],
      error: "credencial whatsapp_api sem WABA ID configurado",
    };
  }

  const { ok, templates, error } = await listarTemplatesMeta({
    accessToken: cred.access_token,
    wabaId: cred.waba_id,
    graphVersion: cred.graph_version,
  });

  if (!ok) {
    return { available: false, templates: [], error };
  }

  const approved = templates.filter((t) => t.status.toUpperCase() === "APPROVED");
  return { available: true, templates: approved };
}

const metaTemplateSchema = z
  .object({
    name: z.string().min(1).max(200),
    lang: z.string().min(1).max(20),
    vars: z
      .array(
        z.object({
          kind: z.enum(["field", "fixed"]),
          value: z.string().max(500),
        }),
      )
      .max(20),
    body: z.string().max(5000),
  })
  .nullable()
  .optional();

const touchSchema = z.object({
  delayDays: z.coerce.number().int().min(0).max(365),
  subject: z.string().max(300).optional(),
  body: z.string().min(1, "corpo obrigatorio").max(5000),
});

const sequenceSchema = z
  .array(touchSchema)
  .min(1, "adicione ao menos uma mensagem")
  .max(10)
  .superRefine((touches, ctx) => {
    if (touches[0] && touches[0].delayDays !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a mensagem inicial deve ter envio imediato",
        path: [0, "delayDays"],
      });
    }
  });

function normalizeSequence(
  channel: z.infer<typeof channelSchema>,
  touches: z.infer<typeof touchSchema>[],
) {
  return touches.map((t, i) => ({
    delayDays: i === 0 ? 0 : Math.max(0, t.delayDays),
    ...(channel === "email" && t.subject?.trim()
      ? { subject: t.subject.trim() }
      : {}),
    body: t.body,
  }));
}

const createSchema = z.object({
  name: z.string().min(1, "informe o nome").max(120),
  channel: channelSchema,
  sequenceJson: sequenceSchema,
  metaTemplate: metaTemplateSchema,
});

export type CreateOutreachInput = z.infer<typeof createSchema>;

type MetaTemplateColumns = {
  metaTemplateName: string | null;
  metaTemplateLang: string | null;
  metaTemplateVars: string | null;
  metaTemplateBody: string | null;
};

// Template so se aplica ao canal whatsapp (Meta oficial). Nos demais, limpa.
function buildMetaTemplateColumns(
  channel: z.infer<typeof channelSchema>,
  template: z.infer<typeof metaTemplateSchema>,
): MetaTemplateColumns {
  if (channel !== "whatsapp" || !template) {
    return {
      metaTemplateName: null,
      metaTemplateLang: null,
      metaTemplateVars: null,
      metaTemplateBody: null,
    };
  }
  return {
    metaTemplateName: template.name,
    metaTemplateLang: template.lang,
    metaTemplateVars: serializeTemplateVars(template.vars),
    metaTemplateBody: template.body,
  };
}

export async function createOutreachCampaign(input: CreateOutreachInput) {
  const { organizationId } = await requireOrg();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }
  const data = parsed.data;

  const [row] = await db
    .insert(outreachCampaigns)
    .values({
      organizationId,
      name: data.name.trim(),
      channel: data.channel,
      sequenceJson: normalizeSequence(data.channel, data.sequenceJson),
      ...buildMetaTemplateColumns(data.channel, data.metaTemplate),
      active: true,
      sendPaused: false,
    })
    .returning({ id: outreachCampaigns.id });

  if (!row) return { error: "falha ao criar campanha" };

  revalidatePath("/outreach");
  return { ok: true as const, id: row.id };
}

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1, "informe o nome").max(120),
  channel: channelSchema,
  active: z.boolean(),
  sendPaused: z.boolean(),
  dailyCap: z.coerce.number().int().min(1).max(5000),
  sequenceJson: sequenceSchema,
  metaTemplate: metaTemplateSchema,
});

export type UpdateOutreachInput = z.infer<typeof updateSchema>;

export async function updateOutreachCampaign(input: UpdateOutreachInput) {
  const { organizationId } = await requireOrg();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.flatten() };
  }
  const data = parsed.data;

  const found = await db
    .select({ id: outreachCampaigns.id })
    .from(outreachCampaigns)
    .where(
      and(
        eq(outreachCampaigns.id, data.id),
        eq(outreachCampaigns.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (found.length === 0) return { error: "campanha nao encontrada" };

  await db
    .update(outreachCampaigns)
    .set({
      name: data.name.trim(),
      channel: data.channel,
      active: data.active,
      sendPaused: data.sendPaused,
      dailyCap: data.dailyCap,
      sequenceJson: normalizeSequence(data.channel, data.sequenceJson),
      ...buildMetaTemplateColumns(data.channel, data.metaTemplate),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(outreachCampaigns.id, data.id),
        eq(outreachCampaigns.organizationId, organizationId),
      ),
    );

  revalidatePath("/outreach");
  revalidatePath(`/outreach/${data.id}`);
  return { ok: true as const };
}

export async function toggleOutreachCampaign(id: string, active: boolean) {
  const { organizationId } = await requireOrg();

  const found = await db
    .select({ id: outreachCampaigns.id })
    .from(outreachCampaigns)
    .where(
      and(
        eq(outreachCampaigns.id, id),
        eq(outreachCampaigns.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (found.length === 0) return { error: "campanha nao encontrada" };

  await db
    .update(outreachCampaigns)
    .set({ active, updatedAt: new Date() })
    .where(
      and(
        eq(outreachCampaigns.id, id),
        eq(outreachCampaigns.organizationId, organizationId),
      ),
    );

  revalidatePath("/outreach");
  revalidatePath(`/outreach/${id}`);
  return { ok: true as const };
}

export async function deleteOutreachCampaign(id: string) {
  const { organizationId } = await requireOrg();

  const found = await db
    .select({ id: outreachCampaigns.id })
    .from(outreachCampaigns)
    .where(
      and(
        eq(outreachCampaigns.id, id),
        eq(outreachCampaigns.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (found.length === 0) return { error: "campanha nao encontrada" };

  // campaign_leads tem FK onDelete cascade, entao os leads da campanha somem
  // junto. Jobs pendentes na fila que referenciem esta campanha falham
  // graciosamente (o handler nao encontra o campaign_lead e ignora).
  await db
    .delete(outreachCampaigns)
    .where(
      and(
        eq(outreachCampaigns.id, id),
        eq(outreachCampaigns.organizationId, organizationId),
      ),
    );

  revalidatePath("/outreach");
  redirect("/outreach");
}
