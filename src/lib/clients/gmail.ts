import "server-only";
import { google, type gmail_v1 } from "googleapis";
import { and, desc, eq } from "drizzle-orm";

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
import { db } from "@/lib/db/node";
import { credentials } from "@/db/schema/credentials";
import {
  decryptCredential,
  encryptCredential,
} from "@/lib/crypto/credentials";

export type GmailOAuthPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
  scope: string;
  tokenType?: string;
  idToken?: string;
};

export class GmailNotConnectedError extends Error {
  constructor() {
    super("Gmail nao conectado para esta organizacao");
    this.name = "GmailNotConnectedError";
  }
}

export type GoogleOAuthAppConfig = {
  clientId: string;
  clientSecret: string;
};

function getRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  return `${base}/api/auth/google/callback`;
}

export async function loadGoogleOAuthAppConfig(
  organizationId: string,
): Promise<GoogleOAuthAppConfig | null> {
  const rows = await db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.organizationId, organizationId),
        eq(credentials.provider, "google_oauth_config"),
      ),
    )
    .orderBy(desc(credentials.createdAt))
    .limit(1);
  if (!rows[0]) return null;
  try {
    return await decryptCredential<GoogleOAuthAppConfig>(rows[0].ciphertext);
  } catch {
    return null;
  }
}

export async function createOAuthClientForOrg(organizationId: string): Promise<OAuth2Client> {
  const dbConfig = await loadGoogleOAuthAppConfig(organizationId);
  const clientId = dbConfig?.clientId ?? process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = dbConfig?.clientSecret ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Configure as credenciais do Google OAuth nas configuracoes");
  }
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

export function createOAuthClient(): OAuth2Client {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Configure as credenciais do Google OAuth nas configuracoes");
  }
  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "openid",
  "email",
  "profile",
];

async function loadCredentialRow(organizationId: string) {
  const rows = await db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.organizationId, organizationId),
        eq(credentials.provider, "google_oauth"),
      ),
    )
    .orderBy(desc(credentials.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

async function saveCredentialPayload(
  credentialId: string,
  payload: GmailOAuthPayload,
) {
  const ciphertext = await encryptCredential(
    payload as unknown as Record<string, unknown>,
  );
  await db
    .update(credentials)
    .set({ ciphertext, updatedAt: new Date() })
    .where(eq(credentials.id, credentialId));
}

export async function upsertGmailCredential(
  organizationId: string,
  payload: GmailOAuthPayload,
) {
  const existing = await loadCredentialRow(organizationId);
  const ciphertext = await encryptCredential(
    payload as unknown as Record<string, unknown>,
  );
  if (existing) {
    await db
      .update(credentials)
      .set({
        ciphertext,
        label: payload.email,
        updatedAt: new Date(),
      })
      .where(eq(credentials.id, existing.id));
    return existing.id;
  }
  const inserted = await db
    .insert(credentials)
    .values({
      organizationId,
      provider: "google_oauth",
      label: payload.email,
      ciphertext,
    })
    .returning({ id: credentials.id });
  const row = inserted[0];
  if (!row) throw new Error("falha ao salvar credential google_oauth");
  return row.id;
}

export async function getGmailPayload(
  organizationId: string,
): Promise<{ id: string; payload: GmailOAuthPayload } | null> {
  const row = await loadCredentialRow(organizationId);
  if (!row) return null;
  try {
    const payload = await decryptCredential<GmailOAuthPayload>(row.ciphertext);
    if (!payload.refreshToken || !payload.accessToken) return null;
    return { id: row.id, payload };
  } catch {
    return null;
  }
}

export async function getAuthedClient(
  organizationId: string,
): Promise<{ oauth: OAuth2Client; email: string }> {
  const loaded = await getGmailPayload(organizationId);
  if (!loaded) throw new GmailNotConnectedError();

  const { id, payload } = loaded;
  // Usa as credenciais do app (Client ID/Secret) da org, que podem vir do banco
  // (configuradas no frontend) e nao apenas do env. Sem isso o Calendar/Gmail OAuth
  // falha com "Configure as credenciais do Google OAuth" quando o app foi setado no front.
  const oauth = await createOAuthClientForOrg(organizationId);
  oauth.setCredentials({
    access_token: payload.accessToken,
    refresh_token: payload.refreshToken,
    expiry_date: payload.expiresAt,
    scope: payload.scope,
    token_type: payload.tokenType ?? "Bearer",
  });

  const now = Date.now();
  const FIVE_MIN = 5 * 60 * 1000;
  if (!payload.expiresAt || payload.expiresAt - now < FIVE_MIN) {
    const refreshed = await oauth.refreshAccessToken();
    const tok = refreshed.credentials;
    const newPayload: GmailOAuthPayload = {
      accessToken: tok.access_token ?? payload.accessToken,
      refreshToken: tok.refresh_token ?? payload.refreshToken,
      expiresAt: tok.expiry_date ?? now + 55 * 60 * 1000,
      email: payload.email,
      scope: tok.scope ?? payload.scope,
      tokenType: tok.token_type ?? payload.tokenType,
      idToken: tok.id_token ?? payload.idToken,
    };
    await saveCredentialPayload(id, newPayload);
    oauth.setCredentials({
      access_token: newPayload.accessToken,
      refresh_token: newPayload.refreshToken,
      expiry_date: newPayload.expiresAt,
      scope: newPayload.scope,
      token_type: newPayload.tokenType ?? "Bearer",
    });
  }

  return { oauth, email: payload.email };
}

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function buildMimeMessage(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
}): string {
  const boundary = `----=_minerador_${Date.now()}`;
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(opts.subject, "utf-8").toString(
    "base64",
  )}?=`;
  const lines = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${subjectEncoded}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.body,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    opts.body.replace(/\n/g, "<br/>"),
    "",
    `--${boundary}--`,
    "",
  ];
  return lines.join("\r\n");
}

export type SendEmailResult = {
  messageId: string;
  threadId: string;
};

export async function sendEmail(opts: {
  organizationId: string;
  to: string;
  subject: string;
  body: string;
  threadId?: string;
}): Promise<SendEmailResult> {
  const { oauth, email } = await getAuthedClient(opts.organizationId);
  const gmail: gmail_v1.Gmail = google.gmail({ version: "v1", auth: oauth });

  const mime = buildMimeMessage({
    from: email,
    to: opts.to,
    subject: opts.subject,
    body: opts.body,
  });
  const raw = encodeBase64Url(mime);

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
      threadId: opts.threadId,
    },
  });

  const data = res.data;
  if (!data.id) {
    throw new Error("Gmail nao retornou id da mensagem");
  }
  return {
    messageId: data.id,
    threadId: data.threadId ?? data.id,
  };
}

// watchInbox: placeholder da Fase 2b. Implementar setup de Gmail Pub/Sub aqui
// pra receber webhooks de novas mensagens e gerar inbound messages automaticas.
// export async function watchInbox(_organizationId: string): Promise<void> {
//   const { oauth } = await getAuthedClient(_organizationId);
//   const gmail = google.gmail({ version: "v1", auth: oauth });
//   await gmail.users.watch({
//     userId: "me",
//     requestBody: {
//       topicName: process.env.GOOGLE_PUBSUB_TOPIC,
//       labelIds: ["INBOX"],
//     },
//   });
// }
