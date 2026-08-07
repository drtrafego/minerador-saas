import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { credentials } from "@/db/schema/credentials";
import { decryptCredential } from "@/lib/crypto/credentials";

export class MissingCredentialError extends Error {
  constructor(provider: string) {
    super(`Credential ${provider} nao configurada para esta org`);
    this.name = "MissingCredentialError";
  }
}

type ProviderPayloads = {
  google_places: { apiKey: string };
  // Salva pelo frontend como { apiKey }; alguns fluxos antigos usaram { token }.
  apify: { apiKey?: string; token?: string };
  anthropic: { apiKey: string };
  brevo: { apiKey: string; senderEmail: string; senderName?: string; replyToEmail?: string };
  google_oauth: {
    clientId: string;
    clientSecret: string;
    refreshToken?: string;
  };
  instagram_session: { cookies: unknown };
  proxycurl: { apiKey: string };
  // Snake_case para bater com o payload armazenado (base_url, instance_token)
  whatsapp_uazapi: { base_url: string; instance_token: string };
  // Snake_case para bater com o payload armazenado no slot real "whatsapp_api"
  whatsapp_api: {
    phone_number_id: string;
    access_token: string;
    verify_token: string;
    waba_id?: string;
    app_secret?: string;
    graph_version?: string;
  };
  // Agente SDR conversacional (clonado de agente_minerador_lista)
  openrouter: { apiKey: string; model?: string };
  // Vertex AI (Google Cloud) por org — projectId extraido do campo project_id do JSON
  google_vertex: { serviceAccountJson: string; location?: string; model?: string };
  // Hermes (Nous Research) como cerebro do atendimento — API OpenAI-compat por org
  hermes: { baseUrl: string; apiKey: string; model?: string };
};

export async function getOrgCredential<P extends keyof ProviderPayloads>(
  organizationId: string,
  provider: P,
): Promise<ProviderPayloads[P]> {
  const rows = await db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.organizationId, organizationId),
        eq(credentials.provider, provider),
      ),
    )
    // Prioriza a credencial marcada como ativa; se nenhuma estiver marcada,
    // cai na mais recente (comportamento retrocompativel).
    .orderBy(desc(credentials.isActive), desc(credentials.createdAt))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new MissingCredentialError(provider);
  }

  const payload = await decryptCredential<ProviderPayloads[P]>(row.ciphertext);
  return payload;
}
