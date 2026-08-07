import { db } from "@/lib/db/node";
import { credentials } from "@/db/schema/credentials";
import { decryptCredential, encryptCredential } from "@/lib/crypto/credentials";
import { eq, and, desc } from "drizzle-orm";

export type UazAPICredential = {
  base_url: string;
  instance_token: string;
};

export class UazAPINotConfiguredError extends Error {
  constructor() {
    super("whatsapp_uazapi credential nao configurada");
    this.name = "UazAPINotConfiguredError";
  }
}

export class UazAPIError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "UazAPIError";
    this.statusCode = statusCode;
  }
}

export class UazAPIPhoneNotFoundError extends Error {
  constructor(phone: string) {
    super(`numero nao registrado no WhatsApp: ${phone}`);
    this.name = "UazAPIPhoneNotFoundError";
  }
}

export async function loadUazAPICredential(
  organizationId: string,
): Promise<{ id: string; cred: UazAPICredential } | null> {
  const row = await db.query.credentials.findFirst({
    where: and(
      eq(credentials.organizationId, organizationId),
      eq(credentials.provider, "whatsapp_uazapi"),
    ),
    orderBy: desc(credentials.createdAt),
  });
  if (!row) return null;
  try {
    const cred = await decryptCredential<UazAPICredential>(row.ciphertext);
    return { id: row.id, cred };
  } catch {
    return null;
  }
}

export async function saveUazAPICredential(
  organizationId: string,
  cred: UazAPICredential,
): Promise<string> {
  const ciphertext = await encryptCredential(cred);
  const existing = await loadUazAPICredential(organizationId);
  if (existing) {
    await db
      .update(credentials)
      .set({ ciphertext, updatedAt: new Date() })
      .where(eq(credentials.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(credentials)
    .values({
      organizationId,
      provider: "whatsapp_uazapi",
      label: `UazAPI ${new URL(cred.base_url).hostname}`,
      ciphertext,
    })
    .returning({ id: credentials.id });
  return row.id;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export async function getUazAPIStatus(
  cred: UazAPICredential,
): Promise<"connected" | "disconnected" | "connecting"> {
  try {
    const url = `${cred.base_url.replace(/\/$/, "")}/instance/status`;
    const res = await fetch(url, {
      headers: { token: cred.instance_token },
    });
    if (!res.ok) return "disconnected";
    const json = (await res.json()) as { state?: string };
    if (json.state === "connected") return "connected";
    if (json.state === "connecting") return "connecting";
    return "disconnected";
  } catch {
    return "disconnected";
  }
}

export async function sendUazAPIMessage(params: {
  organizationId: string;
  phone: string;
  body: string;
}): Promise<{ messageId: string }> {
  const result = await loadUazAPICredential(params.organizationId);
  if (!result) throw new UazAPINotConfiguredError();

  const { base_url, instance_token } = result.cred;
  const number = normalizePhone(params.phone);
  const url = `${base_url.replace(/\/$/, "")}/message/sendText`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      token: instance_token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ number, text: params.body }),
  });

  if (res.status === 400) {
    throw new UazAPIPhoneNotFoundError(params.phone);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new UazAPIError(`UazAPI erro ${res.status}: ${text}`, res.status);
  }

  const json = (await res.json()) as { id?: string; key?: { id: string } };
  const messageId = json.id ?? json.key?.id ?? `uazapi-${Date.now()}`;
  return { messageId };
}
