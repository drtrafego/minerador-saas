import { sql } from "drizzle-orm";
import {
  text,
  timestamp,
  date,
  uuid,
  jsonb,
  integer,
  numeric,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";
import { organization } from "./auth";

// FASE 0 da automacao diaria de prospeccao: aquecimento (warm-up) de envio por
// canal, configuracao de rotacao de mineracao, e plano diario de disparo
// (aprovacao ou automatico). Ver memoria project_automacao_prospeccao.md.

// Canal aquecido: hoje so whatsapp e email tem trava de warm-up.
export const channelWarmupChannelEnum = ms.enum("channel_warmup_channel", [
  "whatsapp",
  "email",
]);

// Modo de disparo do plano diario: automatico ou aguardando aprovacao humana.
export const automationDispatchModeEnum = ms.enum("automation_dispatch_mode", [
  "auto",
  "approval",
]);

// Status do plano diario de envio (por org+data+canal).
export const dailySendPlanStatusEnum = ms.enum("daily_send_plan_status", [
  "pending",
  "approved",
  "rejected",
  "auto",
  "expired",
]);

// Status de um item (lead) dentro do plano diario.
export const dailySendPlanItemStatusEnum = ms.enum("daily_send_plan_item_status", [
  "planned",
  "sent",
  "skipped",
]);

// Combo de rotacao de mineracao (nicho + cidade opcional + fonte).
export type AutomationRotationCombo = {
  niche: string;
  city?: string;
  sourceType: string;
};

// Roteamento de canal por nicho: leads de um nicho saem por um canal
// (whatsapp/email) usando uma campanha de abordagem especifica. Assim
// restaurante vai por WhatsApp e nichos B2B (advogado, clinica) vao por email,
// cada um com sua propria mensagem. Se um nicho nao estiver aqui, cai no
// fallback de canal (whatsappCampaignId/emailCampaignId).
export type AutomationNicheRouting = {
  niche: string;
  channel: "whatsapp" | "email";
  campaignId: string;
};

// Curva de aquecimento por org+canal: comeca em startCap, sobe stepSize a
// cada stepEveryDays dias desde startedAt, ate maxCap. WhatsApp tambem trava
// por custo diario (costCapUsd / costPerMsgUsd).
export const channelWarmup = ms.table(
  "channel_warmup",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    channel: channelWarmupChannelEnum("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    startedAt: date("started_at").notNull().defaultNow(),
    startCap: integer("start_cap").notNull().default(25),
    stepEveryDays: numeric("step_every_days", { precision: 5, scale: 2 })
      .notNull()
      .default("3.5"),
    stepSize: integer("step_size").notNull().default(25),
    maxCap: integer("max_cap").notNull().default(250),
    costCapUsd: numeric("cost_cap_usd", { precision: 10, scale: 4 })
      .notNull()
      .default("3"),
    costPerMsgUsd: numeric("cost_per_msg_usd", { precision: 10, scale: 6 })
      .notNull()
      .default("0.008"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("channel_warmup_org_channel_idx").on(t.organizationId, t.channel),
  ],
);

// Configuracao geral da automacao diaria por org: liga/desliga mineracao,
// rotacao de combos (nicho/cidade/fonte), modo de disparo e campanhas alvo.
export const automationConfig = ms.table(
  "automation_config",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    miningEnabled: boolean("mining_enabled").notNull().default(false),
    rotationCombos: jsonb("rotation_combos")
      .$type<AutomationRotationCombo[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    rotationCursor: integer("rotation_cursor").notNull().default(0),
    dispatchMode: automationDispatchModeEnum("dispatch_mode")
      .notNull()
      .default("approval"),
    whatsappCampaignId: uuid("whatsapp_campaign_id"),
    emailCampaignId: uuid("email_campaign_id"),
    // Roteamento por nicho: casa cada nicho com seu canal + campanha. Tem
    // precedencia sobre whatsappCampaignId/emailCampaignId (que viram fallback).
    nicheRouting: jsonb("niche_routing")
      .$type<AutomationNicheRouting[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    notifyChannel: text("notify_channel"),
    notifyTarget: text("notify_target"),
    // Clientes proprios do dono que nao devem ser prospectados: lista de termos
    // (nome/telefone/@) casados case-insensitive/contains no ingest. Lead que
    // bater entra ja com do_not_disturb=true.
    blocklist: jsonb("blocklist")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("automation_config_org_idx").on(t.organizationId),
  ],
);

// Plano diario de disparo por org+data+canal: cap do dia (warm-up), consumo
// ja feito, quantidade planejada e status (pendente de aprovacao, aprovado,
// rejeitado, auto ou expirado).
export const dailySendPlan = ms.table(
  "daily_send_plan",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    planDate: date("plan_date").notNull(),
    channel: text("channel").notNull(),
    capDia: integer("cap_dia").notNull(),
    consumo: integer("consumo").notNull().default(0),
    planejado: integer("planejado").notNull().default(0),
    custoEstimadoUsd: numeric("custo_estimado_usd", { precision: 10, scale: 4 }),
    status: dailySendPlanStatusEnum("status").notNull().default("pending"),
    outreachCampaignId: uuid("outreach_campaign_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("daily_send_plan_org_date_channel_idx").on(
      t.organizationId,
      t.planDate,
      t.channel,
    ),
  ],
);

// Item (lead) dentro de um plano diario, com status individual de disparo.
export const dailySendPlanItem = ms.table(
  "daily_send_plan_item",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    planId: uuid("plan_id")
      .notNull()
      .references(() => dailySendPlan.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull(),
    // Campanha de abordagem deste lead especifico (resolvida pelo nicho no
    // momento do plano). Permite um mesmo plano de email carregar leads de
    // nichos diferentes, cada um com sua campanha. Null = usa fallback do canal.
    outreachCampaignId: uuid("outreach_campaign_id"),
    status: dailySendPlanItemStatusEnum("status").notNull().default("planned"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("daily_send_plan_item_plan_idx").on(t.planId),
    index("daily_send_plan_item_lead_idx").on(t.leadId),
  ],
);

export type ChannelWarmup = typeof channelWarmup.$inferSelect;
export type NewChannelWarmup = typeof channelWarmup.$inferInsert;
export type AutomationConfig = typeof automationConfig.$inferSelect;
export type NewAutomationConfig = typeof automationConfig.$inferInsert;
export type DailySendPlan = typeof dailySendPlan.$inferSelect;
export type NewDailySendPlan = typeof dailySendPlan.$inferInsert;
export type DailySendPlanItem = typeof dailySendPlanItem.$inferSelect;
export type NewDailySendPlanItem = typeof dailySendPlanItem.$inferInsert;
