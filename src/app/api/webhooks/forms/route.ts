import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { leads } from "@/db/schema/leads";
import { organization } from "@/db/schema/auth";
import { events, webhooksLog } from "@/db/schema/events";
import { minings as campaigns } from "@/db/schema/minings";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

type FormPayload = Record<string, unknown>;

const FIELD_MAP: Record<string, string[]> = {
  displayName: [
    "name", "nome", "full_name", "fullname", "full name", "display_name",
    "nome completo", "seu nome",
  ],
  email: ["email", "e-mail", "seu email", "endereco de email"],
  phone: [
    "phone", "telefone", "celular", "whatsapp", "seu telefone", "tel",
    "mobile", "contact_number",
  ],
  handle: ["handle", "username", "usuario", "instagram", "user"],
  website: ["website", "site", "url", "empresa_site", "company_site"],
  city: ["city", "cidade"],
  region: ["region", "state", "estado", "uf"],
  country: ["country", "pais"],
  company: ["company", "empresa", "companhia", "nome da empresa"],
  headline: ["headline", "cargo", "title", "titulo", "funcao"],
  linkedinUrl: ["linkedin", "linkedin_url", "linkedinurl"],
};

const ROOT_KEYS = ["data", "form_response", "answers", "fields", "form", "payload"];

function flatten(obj: unknown, prefix = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (obj === null || obj === undefined) return out;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        const label =
          (typeof rec.label === "string" && rec.label) ||
          (typeof rec.title === "string" && rec.title) ||
          (typeof rec.key === "string" && rec.key) ||
          (typeof rec.name === "string" && rec.name);
        const val =
          rec.value !== undefined
            ? rec.value
            : rec.answer !== undefined
              ? rec.answer
              : rec.text !== undefined
                ? rec.text
                : rec;
        if (label && (typeof val === "string" || typeof val === "number")) {
          out[normalize(String(label))] = val;
        } else {
          flatten(item, prefix, out);
        }
      }
    }
    return out;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "object") flatten(v, prefix ? `${prefix}.${k}` : k, out);
      else out[normalize(k)] = v;
    }
  }
  return out;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function matchField(flat: Record<string, unknown>, candidates: string[]): string | null {
  for (const c of candidates) {
    const key = normalize(c);
    for (const [k, v] of Object.entries(flat)) {
      if (k === key && typeof v !== "object" && v != null && String(v).trim()) {
        return String(v).trim();
      }
    }
    for (const [k, v] of Object.entries(flat)) {
      if (k.includes(key) && typeof v !== "object" && v != null && String(v).trim()) {
        return String(v).trim();
      }
    }
  }
  return null;
}

async function resolveOrganization(orgToken: string): Promise<string | null> {
  const rows = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, orgToken))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function resolveCampaign(orgId: string, token: string | null): Promise<string | null> {
  if (!token) return null;
  const byId = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.id, token), eq(campaigns.organizationId, orgId)))
    .limit(1);
  return byId[0]?.id ?? null;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const orgToken = url.searchParams.get("org");
  const campaignToken = url.searchParams.get("campaign");
  const secret = url.searchParams.get("secret") ?? req.headers.get("x-forms-secret");
  const expected = process.env.FORMS_WEBHOOK_SECRET;

  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "FORMS_WEBHOOK_SECRET nao configurado no servidor" },
      { status: 503 },
    );
  }
  if (!secret || secret !== expected) {
    return NextResponse.json({ ok: false, error: "invalid secret" }, { status: 401 });
  }
  if (!orgToken) {
    return NextResponse.json({ ok: false, error: "missing org" }, { status: 400 });
  }

  const orgId = await resolveOrganization(orgToken);
  if (!orgId) {
    return NextResponse.json({ ok: false, error: "org not found" }, { status: 404 });
  }

  const campaignId = await resolveCampaign(orgId, campaignToken);

  let body: FormPayload;
  try {
    body = (await req.json()) as FormPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  await db.insert(webhooksLog).values({
    provider: "forms",
    event: "lead.submit",
    payload: body as Record<string, unknown>,
    signature: null,
    organizationId: orgId,
  });

  let target: unknown = body;
  for (const key of ROOT_KEYS) {
    if (target && typeof target === "object" && key in (target as object)) {
      target = (target as Record<string, unknown>)[key];
    }
  }
  const flat = flatten(target);

  const displayName = matchField(flat, FIELD_MAP.displayName);
  if (!displayName) {
    return NextResponse.json(
      { ok: false, error: "nao foi possivel identificar nome no payload" },
      { status: 422 },
    );
  }

  const email = matchField(flat, FIELD_MAP.email);
  const phone = matchField(flat, FIELD_MAP.phone);
  const handle = matchField(flat, FIELD_MAP.handle);
  const website = matchField(flat, FIELD_MAP.website);
  const city = matchField(flat, FIELD_MAP.city);
  const region = matchField(flat, FIELD_MAP.region);
  const country = matchField(flat, FIELD_MAP.country);
  const company = matchField(flat, FIELD_MAP.company);
  const headline = matchField(flat, FIELD_MAP.headline);
  const linkedinUrl = matchField(flat, FIELD_MAP.linkedinUrl);

  const externalId = `form-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const inserted = await db
    .insert(leads)
    .values({
      organizationId: orgId,
      miningId: campaignId ?? null,
      source: "manual",
      externalId,
      displayName,
      handle,
      email,
      phone,
      website,
      city,
      region,
      country,
      company,
      headline,
      linkedinUrl,
      rawData: { source: "form", received: body, flattened: flat },
      qualificationStatus: "pending",
    })
    .onConflictDoNothing({
      target: [leads.organizationId, leads.source, leads.externalId],
    })
    .returning({ id: leads.id });

  const leadId = inserted[0]?.id;
  if (leadId) {
    await db.insert(events).values({
      organizationId: orgId,
      type: "lead.form.received",
      entityType: "lead",
      entityId: leadId,
      data: { campaignId, flat },
    });
  }

  return NextResponse.json({
    ok: true,
    leadId: leadId ?? null,
    campaignId,
  });
}
