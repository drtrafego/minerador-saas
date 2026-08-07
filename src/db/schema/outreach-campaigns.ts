import { sql } from "drizzle-orm";
import {
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";
import { organization } from "./auth";
import { leads } from "./leads";

// Canais de abordagem suportados pela campanha de outreach.
export const outreachCampaignChannelEnum = ms.enum("outreach_campaign_channel", [
  "email",
  "whatsapp",
  "instagram_dm",
  "linkedin_dm",
]);

// Status de um lead dentro de uma campanha de abordagem.
export const campaignLeadStatusEnum = ms.enum("campaign_lead_status", [
  "enqueued",
  "sent",
  "failed",
  "replied",
  "skipped",
]);

// Um toque da sequencia de abordagem. O corpo aceita variaveis no formato {{nome}}.
export type OutreachTouch = {
  delayDays: number;
  subject?: string;
  body: string;
};

// Entidade final de campanha de abordagem (separada da tabela campaigns atual,
// que ainda mistura mineracao e abordagem). O rename de campaigns vem em fase futura.
export const outreachCampaigns = ms.table(
  "outreach_campaigns",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    channel: outreachCampaignChannelEnum("channel").notNull(),
    sequenceJson: jsonb("sequence_json")
      .$type<OutreachTouch[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // Template aprovado da Meta (WABA) para abertura fria via WhatsApp oficial.
    // metaTemplateVars guarda VarSpec[] serializado (ver lib/utils/template-vars).
    metaTemplateName: text("meta_template_name"),
    metaTemplateLang: text("meta_template_lang").default("pt_BR"),
    metaTemplateVars: text("meta_template_vars"),
    metaTemplateBody: text("meta_template_body"),
    smartFollowUp: boolean("smart_follow_up").notNull().default(false),
    dailyCap: integer("daily_cap").notNull().default(50),
    sendIntervalMinSeconds: integer("send_interval_min_seconds")
      .notNull()
      .default(60),
    sendIntervalMaxSeconds: integer("send_interval_max_seconds")
      .notNull()
      .default(180),
    active: boolean("active").notNull().default(true),
    sendPaused: boolean("send_paused").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("outreach_campaigns_org_idx").on(t.organizationId)],
);

// Junction entre campanha de abordagem e lead, com estado de progresso por lead.
export const campaignLeads = ms.table(
  "campaign_leads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    outreachCampaignId: uuid("outreach_campaign_id")
      .notNull()
      .references(() => outreachCampaigns.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    externalRef: text("external_ref"),
    status: campaignLeadStatusEnum("status").notNull().default("enqueued"),
    step: integer("step").notNull().default(0),
    contactedAt: timestamp("contacted_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("campaign_leads_campaign_ref_idx").on(
      t.outreachCampaignId,
      t.externalRef,
    ),
    index("campaign_leads_lead_idx").on(t.leadId),
    index("campaign_leads_org_idx").on(t.organizationId),
  ],
);
