import { sql } from "drizzle-orm";
import {
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";
import { organization } from "./auth";

export const agentConfigs = ms.table(
  "agent_configs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    businessName: text("business_name"),
    businessInfo: text("business_info"),
    tone: text("tone").notNull().default("profissional e direto"),
    systemPromptOverride: text("system_prompt_override"),
    rules: jsonb("rules")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    handoffKeywords: jsonb("handoff_keywords")
      .$type<string[]>()
      .notNull()
      .default(sql`'["humano","atendente","pessoa real","parar","stop"]'::jsonb`),
    agentName: text("agent_name").notNull().default("Isabela"),
    preferredProvider: text("preferred_provider").notNull().default("auto"),
    maxAutoReplies: integer("max_auto_replies").notNull().default(6),
    model: text("model").notNull().default("claude-sonnet-4-5"),
    followUpModel: text("follow_up_model"),
    knowledgeModel: text("knowledge_model"),
    temperature: integer("temperature").notNull().default(70),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_configs_org_idx").on(t.organizationId)],
);
