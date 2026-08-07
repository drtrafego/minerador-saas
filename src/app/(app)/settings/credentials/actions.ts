"use server";

import { revalidatePath } from "next/cache";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { credentials } from "@/db/schema/credentials";
import { encryptCredential, decryptCredential } from "@/lib/crypto/credentials";
import { requireOrg } from "@/lib/auth/guards";

const providerEnum = z.enum([
  "anthropic",
  "apify",
  "brevo",
  "google_oauth",
  "google_oauth_config",
  "google_places",
  "google_vertex",
  "instagram_session",
  "openrouter",
  "whatsapp_api",
  "whatsapp_uazapi",
]);

const createSchema = z.object({
  provider: providerEnum,
  label: z.string().min(1).max(100),
  payload: z.string().min(1),
});

export async function createCredential(formData: FormData) {
  const { organizationId } = await requireOrg();

  const parsed = createSchema.safeParse({
    provider: formData.get("provider"),
    label: formData.get("label"),
    payload: formData.get("payload"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  let payloadObj: Record<string, unknown>;
  try {
    payloadObj = JSON.parse(parsed.data.payload);
    if (typeof payloadObj !== "object" || payloadObj === null || Array.isArray(payloadObj)) {
      return { error: { payload: ["JSON deve ser um objeto"] } };
    }
  } catch {
    return { error: { payload: ["JSON invalido"] } };
  }

  const ciphertext = await encryptCredential(payloadObj);

  await db.insert(credentials).values({
    organizationId,
    provider: parsed.data.provider,
    label: parsed.data.label,
    ciphertext,
  });

  revalidatePath("/settings/credentials");
  return { ok: true };
}

const apiKeySchema = z.object({
  provider: providerEnum,
  label: z.string().min(1).max(100),
  apiKey: z.string().min(1),
});

export async function saveApiKey(formData: FormData) {
  const { organizationId } = await requireOrg();

  const parsed = apiKeySchema.safeParse({
    provider: formData.get("provider"),
    label: formData.get("label"),
    apiKey: formData.get("apiKey"),
  });
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const ciphertext = await encryptCredential({ apiKey: parsed.data.apiKey });

  await db.insert(credentials).values({
    organizationId,
    provider: parsed.data.provider,
    label: parsed.data.label,
    ciphertext,
  });

  revalidatePath("/settings/credentials");
  return { ok: true };
}

export async function deleteCredential(formData: FormData) {
  const { organizationId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "id obrigatorio" };

  await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.organizationId, organizationId)));

  revalidatePath("/settings/credentials");
  return { ok: true };
}

// Marca uma credencial como ativa (a que o sistema vai usar) e desmarca as
// demais do mesmo provider na org. Util quando ha varias chaves (ex: 5 contas
// Apify) e o usuario quer trocar qual esta em uso.
export async function setActiveCredential(formData: FormData) {
  const { organizationId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "id obrigatorio" };

  const target = await db
    .select({ id: credentials.id, provider: credentials.provider })
    .from(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.organizationId, organizationId)))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!target) return { error: "credencial nao encontrada" };

  await db.transaction(async (tx) => {
    // Desmarca todas do mesmo provider (evita conflito com o indice unico parcial)
    await tx
      .update(credentials)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(credentials.organizationId, organizationId),
          eq(credentials.provider, target.provider),
          eq(credentials.isActive, true),
        ),
      );
    // Marca a escolhida
    await tx
      .update(credentials)
      .set({ isActive: true, updatedAt: new Date() })
      .where(and(eq(credentials.id, id), eq(credentials.organizationId, organizationId)));
  });

  revalidatePath("/settings/credentials");
  return { ok: true };
}

export async function disconnectGmail() {
  const { organizationId } = await requireOrg();
  await db
    .delete(credentials)
    .where(
      and(
        eq(credentials.organizationId, organizationId),
        eq(credentials.provider, "google_oauth"),
      ),
    );
  revalidatePath("/settings/credentials");
  return { ok: true };
}

const googleOAuthConfigSchema = z.object({
  clientId: z.string().min(10),
  clientSecret: z.string().min(10),
});

export async function saveGoogleOAuthConfig(formData: FormData) {
  const { organizationId } = await requireOrg();
  const parsed = googleOAuthConfigSchema.safeParse({
    clientId: formData.get("clientId"),
    clientSecret: formData.get("clientSecret"),
  });
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const ciphertext = await encryptCredential(parsed.data as unknown as Record<string, unknown>);

  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.organizationId, organizationId), eq(credentials.provider, "google_oauth_config")))
    .orderBy(desc(credentials.createdAt))
    .limit(1);

  if (existing[0]) {
    await db.update(credentials).set({ ciphertext, updatedAt: new Date() }).where(eq(credentials.id, existing[0].id));
  } else {
    await db.insert(credentials).values({ organizationId, provider: "google_oauth_config", label: "Google OAuth App", ciphertext });
  }

  revalidatePath("/settings/credentials");
  return { ok: true };
}

export async function loadGoogleOAuthConfigStatus() {
  const { organizationId } = await requireOrg();
  const row = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.organizationId, organizationId), eq(credentials.provider, "google_oauth_config")))
    .orderBy(desc(credentials.createdAt))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) return { configured: false, clientIdPreview: null };
  try {
    const config = await decryptCredential<{ clientId: string; clientSecret: string }>(row.ciphertext);
    return { configured: true, clientIdPreview: config.clientId.slice(0, 8) + "..." };
  } catch {
    return { configured: false, clientIdPreview: null };
  }
}

const brevoSchema = z.object({
  apiKey: z.string().min(10),
  senderEmail: z.string().email(),
  senderName: z.string().max(100).optional(),
  replyToEmail: z.string().email().optional(),
});

export async function saveBrevoCredential(formData: FormData) {
  const { organizationId } = await requireOrg();

  const parsed = brevoSchema.safeParse({
    apiKey: formData.get("apiKey"),
    senderEmail: formData.get("senderEmail"),
    senderName: formData.get("senderName") || undefined,
    replyToEmail: formData.get("replyToEmail") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const payload = {
    apiKey: parsed.data.apiKey,
    senderEmail: parsed.data.senderEmail,
    ...(parsed.data.senderName ? { senderName: parsed.data.senderName } : {}),
    ...(parsed.data.replyToEmail ? { replyToEmail: parsed.data.replyToEmail } : {}),
  };
  const ciphertext = await encryptCredential(payload as unknown as Record<string, unknown>);

  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.organizationId, organizationId), eq(credentials.provider, "brevo")))
    .orderBy(desc(credentials.createdAt))
    .limit(1);

  if (existing[0]) {
    await db
      .update(credentials)
      .set({ ciphertext, label: parsed.data.senderEmail, updatedAt: new Date() })
      .where(eq(credentials.id, existing[0].id));
  } else {
    await db.insert(credentials).values({
      organizationId,
      provider: "brevo",
      label: parsed.data.senderEmail,
      ciphertext,
    });
  }

  revalidatePath("/settings/credentials");
  return { ok: true };
}

const openRouterSchema = z.object({
  label: z.string().min(1).max(100),
  apiKey: z.string().min(1),
  model: z.string().optional(),
});

export async function saveOpenRouterCredential(formData: FormData) {
  const { organizationId } = await requireOrg();

  const parsed = openRouterSchema.safeParse({
    label: formData.get("label"),
    apiKey: formData.get("apiKey"),
    model: formData.get("model") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const payload: Record<string, unknown> = { apiKey: parsed.data.apiKey };
  if (parsed.data.model) payload.model = parsed.data.model;

  const ciphertext = await encryptCredential(payload);

  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(
      and(
        eq(credentials.organizationId, organizationId),
        eq(credentials.provider, "openrouter"),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(credentials)
      .set({ ciphertext, label: parsed.data.label, updatedAt: new Date() })
      .where(eq(credentials.id, existing[0].id));
  } else {
    await db.insert(credentials).values({
      organizationId,
      provider: "openrouter",
      label: parsed.data.label,
      ciphertext,
    });
  }

  revalidatePath("/settings/credentials");
  return { ok: true };
}

export async function loadBrevoStatus(): Promise<{
  configured: boolean;
  senderEmail: string | null;
  senderName: string | null;
  replyToEmail: string | null;
}> {
  const { organizationId } = await requireOrg();
  const row = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.organizationId, organizationId), eq(credentials.provider, "brevo")))
    .orderBy(desc(credentials.createdAt))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) return { configured: false, senderEmail: null, senderName: null, replyToEmail: null };
  try {
    const config = await decryptCredential<{ apiKey: string; senderEmail: string; senderName?: string; replyToEmail?: string }>(row.ciphertext);
    return {
      configured: true,
      senderEmail: config.senderEmail,
      senderName: config.senderName ?? null,
      replyToEmail: config.replyToEmail ?? null,
    };
  } catch {
    return { configured: false, senderEmail: null, senderName: null, replyToEmail: null };
  }
}

// ---- Vertex AI (Google Cloud) ----

const vertexSchema = z.object({
  serviceAccountJson: z.string().min(10),
  location: z.string().max(60).optional(),
  model: z.string().max(100).optional(),
});

export async function saveVertexCredential(formData: FormData) {
  const { organizationId } = await requireOrg();

  const rawJson = String(formData.get("serviceAccountJson") ?? "").trim();
  const location = String(formData.get("location") ?? "").trim() || undefined;
  const model = String(formData.get("model") ?? "").trim() || undefined;

  // Valida que o JSON e parseavel e contem os campos minimos
  let parsed: { project_id?: unknown; client_email?: unknown };
  try {
    parsed = JSON.parse(rawJson) as { project_id?: unknown; client_email?: unknown };
  } catch {
    return { error: { serviceAccountJson: ["JSON invalido"] } };
  }
  if (!parsed.project_id || !parsed.client_email) {
    return { error: { serviceAccountJson: ["JSON deve conter project_id e client_email"] } };
  }

  const validated = vertexSchema.safeParse({ serviceAccountJson: rawJson, location, model });
  if (!validated.success) return { error: validated.error.flatten().fieldErrors };

  const payload: Record<string, unknown> = { serviceAccountJson: rawJson };
  if (location) payload.location = location;
  if (model) payload.model = model;

  const ciphertext = await encryptCredential(payload);

  const projectId = String(parsed.project_id);

  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(
      and(
        eq(credentials.organizationId, organizationId),
        eq(credentials.provider, "google_vertex"),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(credentials)
      .set({ ciphertext, label: projectId, updatedAt: new Date() })
      .where(eq(credentials.id, existing[0].id));
  } else {
    await db.insert(credentials).values({
      organizationId,
      provider: "google_vertex",
      label: projectId,
      ciphertext,
    });
  }

  revalidatePath("/settings/credentials");
  return { ok: true };
}

// ---- Hermes (Nous Research) como cerebro do atendimento ----

const hermesSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().max(100).optional(),
});

export async function saveHermesCredential(formData: FormData) {
  const { organizationId } = await requireOrg();

  const parsed = hermesSchema.safeParse({
    baseUrl: String(formData.get("baseUrl") ?? "").trim(),
    apiKey: String(formData.get("apiKey") ?? "").trim(),
    model: String(formData.get("model") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const payload: Record<string, unknown> = {
    baseUrl: parsed.data.baseUrl.replace(/\/+$/, ""),
    apiKey: parsed.data.apiKey,
  };
  if (parsed.data.model) payload.model = parsed.data.model;

  const ciphertext = await encryptCredential(payload);

  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.organizationId, organizationId), eq(credentials.provider, "hermes")))
    .orderBy(desc(credentials.createdAt))
    .limit(1);

  if (existing[0]) {
    await db
      .update(credentials)
      .set({ ciphertext, label: parsed.data.baseUrl, updatedAt: new Date() })
      .where(eq(credentials.id, existing[0].id));
  } else {
    await db.insert(credentials).values({
      organizationId,
      provider: "hermes",
      label: parsed.data.baseUrl,
      ciphertext,
    });
  }

  revalidatePath("/settings/credentials");
  return { ok: true };
}

export async function loadHermesStatus(): Promise<{
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
}> {
  const { organizationId } = await requireOrg();
  const row = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.organizationId, organizationId), eq(credentials.provider, "hermes")))
    .orderBy(desc(credentials.createdAt))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) return { configured: false, baseUrl: null, model: null };
  try {
    const config = await decryptCredential<{ baseUrl: string; apiKey: string; model?: string }>(row.ciphertext);
    return { configured: true, baseUrl: config.baseUrl, model: config.model ?? null };
  } catch {
    return { configured: false, baseUrl: null, model: null };
  }
}

export async function disconnectHermes() {
  const { organizationId } = await requireOrg();
  await db
    .delete(credentials)
    .where(and(eq(credentials.organizationId, organizationId), eq(credentials.provider, "hermes")));
  revalidatePath("/settings/credentials");
  return { ok: true };
}

export async function loadVertexStatus(): Promise<{
  configured: boolean;
  projectId: string | null;
  location: string | null;
  model: string | null;
}> {
  const { organizationId } = await requireOrg();
  const row = await db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.organizationId, organizationId),
        eq(credentials.provider, "google_vertex"),
      ),
    )
    .orderBy(desc(credentials.createdAt))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) return { configured: false, projectId: null, location: null, model: null };
  try {
    const config = await decryptCredential<{
      serviceAccountJson: string;
      location?: string;
      model?: string;
    }>(row.ciphertext);
    const sa = JSON.parse(config.serviceAccountJson) as { project_id?: string };
    return {
      configured: true,
      projectId: sa.project_id ?? row.label,
      location: config.location ?? "us-central1",
      model: config.model ?? null,
    };
  } catch (err) {
    console.error("[loadVertexStatus] falha ao descriptografar:", (err as Error).message);
    return { configured: false, projectId: null, location: null, model: null };
  }
}
