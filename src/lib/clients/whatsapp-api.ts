import { db } from "@/lib/db/node";
import { credentials } from "@/db/schema/credentials";
import { decryptCredential, encryptCredential } from "@/lib/crypto/credentials";
import { eq, and, desc } from "drizzle-orm";

export type WhatsAppAPICredential = {
  phone_number_id: string;
  access_token: string;
  verify_token: string;
  waba_id?: string;
  app_secret?: string;
  graph_version?: string;
};

export class WhatsAppAPINotConfiguredError extends Error {
  constructor() {
    super("whatsapp_api credential nao configurada");
    this.name = "WhatsAppAPINotConfiguredError";
  }
}

export class WhatsAppAPIError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "WhatsAppAPIError";
    this.statusCode = statusCode;
  }
}

export async function loadWhatsAppAPICredential(
  organizationId: string,
): Promise<{ id: string; cred: WhatsAppAPICredential } | null> {
  const row = await db.query.credentials.findFirst({
    where: and(
      eq(credentials.organizationId, organizationId),
      eq(credentials.provider, "whatsapp_api"),
    ),
    orderBy: desc(credentials.createdAt),
  });
  if (!row) return null;
  try {
    const cred = await decryptCredential<WhatsAppAPICredential>(row.ciphertext);
    return { id: row.id, cred };
  } catch {
    return null;
  }
}

export async function saveWhatsAppAPICredential(
  organizationId: string,
  cred: WhatsAppAPICredential,
): Promise<string> {
  const ciphertext = await encryptCredential(cred);
  const existing = await loadWhatsAppAPICredential(organizationId);
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
      provider: "whatsapp_api",
      label: `WhatsApp API ${cred.phone_number_id}`,
      ciphertext,
    })
    .returning({ id: credentials.id });
  return row.id;
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

// Hosts oficiais da Meta para download de midia (anti-SSRF).
const ALLOWED_MEDIA_HOSTS = new Set(["lookaside.fbsbx.com", "mmg.whatsapp.net"]);

/** Baixa uma midia (ex: audio) da Meta Cloud API: resolve a URL assinada e busca os bytes. */
export async function downloadWhatsAppAPIMedia(
  organizationId: string,
  mediaId: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const result = await loadWhatsAppAPICredential(organizationId);
  if (!result) return null;
  const { access_token } = result.cred;

  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!metaRes.ok) return null;
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
  if (!meta.url) return null;

  // Anti-SSRF: so baixa de hosts oficiais da Meta.
  let host = "";
  try {
    host = new URL(meta.url).hostname;
  } catch {
    return null;
  }
  if (!ALLOWED_MEDIA_HOSTS.has(host)) {
    console.error(`[whatsapp] host de midia nao permitido (SSRF bloqueado): ${host}`);
    return null;
  }

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${access_token}` },
  });
  if (!fileRes.ok) return null;
  const bytes = new Uint8Array(await fileRes.arrayBuffer());
  return { bytes, mimeType: meta.mime_type ?? "audio/ogg" };
}

export async function sendWhatsAppAPIMessage(params: {
  organizationId: string;
  phone: string;
  body: string;
}): Promise<{ messageId: string }> {
  const result = await loadWhatsAppAPICredential(params.organizationId);
  if (!result) throw new WhatsAppAPINotConfiguredError();

  const { phone_number_id, access_token } = result.cred;
  const graphVersion = result.cred.graph_version ?? "v25.0";
  const to = normalizePhone(params.phone);

  const res = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: params.body },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new WhatsAppAPIError(
      `Meta API erro ${res.status}: ${text}`,
      res.status,
    );
  }

  const json = (await res.json()) as { messages: { id: string }[] };
  return { messageId: json.messages[0].id };
}

// Envia uma mensagem de TEMPLATE aprovado na Meta (abordagem fria, fora da janela
// de 24h). Os parametros preenchem {{1}},{{2}}... do corpo, na ordem.
export async function sendWhatsAppTemplate(params: {
  organizationId: string;
  phone: string;
  templateName: string;
  language: string;
  bodyParams: string[];
}): Promise<{ messageId: string }> {
  const result = await loadWhatsAppAPICredential(params.organizationId);
  if (!result) throw new WhatsAppAPINotConfiguredError();

  const { phone_number_id, access_token } = result.cred;
  const graphVersion = result.cred.graph_version ?? "v25.0";
  const to = normalizePhone(params.phone);

  const components = params.bodyParams.length
    ? [
        {
          type: "body",
          parameters: params.bodyParams.map((text) => ({ type: "text", text })),
        },
      ]
    : [];

  const res = await fetch(
    `https://graph.facebook.com/${graphVersion}/${phone_number_id}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: params.templateName,
          language: { code: params.language },
          components,
        },
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new WhatsAppAPIError(
      `Meta API erro ${res.status}: ${text}`,
      res.status,
    );
  }

  const json = (await res.json()) as { messages: { id: string }[] };
  return { messageId: json.messages[0].id };
}
