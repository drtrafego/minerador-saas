"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { credentials } from "@/db/schema/credentials";
import { agentConfigs } from "@/db/schema/agent";
import { encryptCredential } from "@/lib/crypto/credentials";
import { requireOrg } from "@/lib/auth/guards";

const metaSchema = z.object({
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(10),
  verifyToken: z.string().min(4),
  // Campos opcionais — recomendado preencher para templates e validacao HMAC
  wabaId: z.string().min(1).optional(),
  appSecret: z.string().min(1).optional(),
  graphVersion: z.string().min(1).optional(),
});

export async function saveWhatsAppMeta(formData: FormData) {
  const { organizationId } = await requireOrg();
  const parsed = metaSchema.safeParse({
    phoneNumberId: formData.get("phoneNumberId"),
    accessToken: formData.get("accessToken"),
    verifyToken: formData.get("verifyToken"),
    wabaId: (formData.get("wabaId") as string | null) || undefined,
    appSecret: (formData.get("appSecret") as string | null) || undefined,
    graphVersion: (formData.get("graphVersion") as string | null) || undefined,
  });
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const payload: Record<string, unknown> = {
    phone_number_id: parsed.data.phoneNumberId,
    access_token: parsed.data.accessToken,
    verify_token: parsed.data.verifyToken,
  };
  if (parsed.data.wabaId) payload.waba_id = parsed.data.wabaId;
  if (parsed.data.appSecret) payload.app_secret = parsed.data.appSecret;
  if (parsed.data.graphVersion) payload.graph_version = parsed.data.graphVersion;

  const ciphertext = await encryptCredential(payload);
  const label = `WhatsApp Meta ${parsed.data.phoneNumberId}`;

  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.organizationId, organizationId), eq(credentials.provider, "whatsapp_api")))
    .limit(1);

  if (existing[0]) {
    await db.update(credentials).set({ ciphertext, label, updatedAt: new Date() }).where(eq(credentials.id, existing[0].id));
  } else {
    await db.insert(credentials).values({ organizationId, provider: "whatsapp_api", label, ciphertext });
  }

  revalidatePath("/settings/credentials/whatsapp");
  return { ok: true };
}

const uazapiSchema = z.object({
  baseUrl: z.string().url(),
  instanceToken: z.string().min(4),
});

export async function saveUazAPI(formData: FormData) {
  const { organizationId } = await requireOrg();
  const parsed = uazapiSchema.safeParse({
    baseUrl: formData.get("baseUrl"),
    instanceToken: formData.get("instanceToken"),
  });
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const payload = {
    base_url: parsed.data.baseUrl,
    instance_token: parsed.data.instanceToken,
  };
  const ciphertext = await encryptCredential(payload as unknown as Record<string, unknown>);

  let hostname = parsed.data.baseUrl;
  try { hostname = new URL(parsed.data.baseUrl).hostname; } catch {}
  const label = `UazAPI ${hostname}`;

  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.organizationId, organizationId), eq(credentials.provider, "whatsapp_uazapi")))
    .limit(1);

  if (existing[0]) {
    await db.update(credentials).set({ ciphertext, label, updatedAt: new Date() }).where(eq(credentials.id, existing[0].id));
  } else {
    await db.insert(credentials).values({ organizationId, provider: "whatsapp_uazapi", label, ciphertext });
  }

  revalidatePath("/settings/credentials/whatsapp");
  return { ok: true };
}

export async function deleteWhatsAppCredential(formData: FormData) {
  const { organizationId } = await requireOrg();
  const provider = formData.get("provider") as string;
  if (!["whatsapp_api", "whatsapp_uazapi"].includes(provider)) return { error: "provider invalido" };

  await db
    .delete(credentials)
    .where(
      and(
        eq(credentials.organizationId, organizationId),
        eq(credentials.provider, provider as "whatsapp_api" | "whatsapp_uazapi"),
      ),
    );

  revalidatePath("/settings/credentials/whatsapp");
  return { ok: true };
}

const preferredProviderSchema = z.enum(["auto", "meta", "uazapi"]);

export async function savePreferredProvider(formData: FormData) {
  const { organizationId } = await requireOrg();
  const parsed = preferredProviderSchema.safeParse(formData.get("preferredProvider"));
  if (!parsed.success) return { error: "provider invalido" };

  const existing = await db
    .select({ id: agentConfigs.id })
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, organizationId))
    .limit(1);

  if (existing[0]) {
    await db.update(agentConfigs).set({ preferredProvider: parsed.data, updatedAt: new Date() }).where(eq(agentConfigs.id, existing[0].id));
  } else {
    await db.insert(agentConfigs).values({ organizationId, preferredProvider: parsed.data });
  }

  revalidatePath("/settings/credentials/whatsapp");
  return { ok: true };
}
