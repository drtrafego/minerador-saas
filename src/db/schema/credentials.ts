import { sql } from "drizzle-orm";
import {
  boolean,
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";
import { organization } from "./auth";

export const credentialProviderEnum = ms.enum("credential_provider", [
  "anthropic",
  "apify",
  "brevo",
  "google_oauth",
  "google_oauth_config",
  "google_places",
  "instagram_session",
  "linkedin_session",
  "proxycurl",
  "whatsapp_session",
  "whatsapp_api",
  "whatsapp_uazapi",
  // Agente SDR conversacional (clonado de agente_minerador_lista)
  "openrouter",
  "whatsapp_meta",
  // Vertex AI (Google Cloud) por org
  "google_vertex",
  // Hermes (Nous Research) como cerebro do atendimento, por org
  "hermes",
]);

export const credentials = ms.table(
  "credentials",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: credentialProviderEnum("provider").notNull(),
    label: text("label").notNull(),
    ciphertext: text("ciphertext").notNull(),
    // Quando ha varias credenciais do mesmo provider na org, esta marca qual
    // esta em uso. So uma por (org, provider) deve ficar true. Se nenhuma
    // estiver marcada, o getOrgCredential cai na mais recente (retrocompativel).
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credentials_org_provider_idx").on(t.organizationId, t.provider)],
);
