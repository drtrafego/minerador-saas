import { sql } from "drizzle-orm";
import {
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";
import { organization } from "./auth";
import { minings } from "./minings";

export const jobStatusEnum = ms.enum("job_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const scrapingJobs = ms.table(
  "scraping_jobs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    miningId: uuid("mining_id").references(() => minings.id, {
      onDelete: "set null",
    }),
    sourceType: text("source_type").notNull(),
    input: jsonb("input").notNull().$type<Record<string, unknown>>(),
    status: jobStatusEnum("status").notNull().default("pending"),
    leadsFound: integer("leads_found").notNull().default(0),
    leadsInserted: integer("leads_inserted").notNull().default(0),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scraping_jobs_org_campaign_status_idx").on(
      t.organizationId,
      t.miningId,
      t.status,
    ),
  ],
);

export const qualificationJobs = ms.table(
  "qualification_jobs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    miningId: uuid("mining_id").references(() => minings.id, {
      onDelete: "set null",
    }),
    leadId: uuid("lead_id").notNull(),
    status: jobStatusEnum("status").notNull().default("pending"),
    model: text("model"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("qualification_jobs_org_status_idx").on(t.organizationId, t.status),
  ],
);

export const sendCounters = ms.table(
  "send_counters",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Contador generico por campanha: guarda o id de outreach_campaigns (abordagem)
    // OU de minings, conforme o fluxo. SEM FK para nao amarrar a uma tabela so
    // (a FK antiga apontava para minings e quebrava o outreach com "violates FK").
    campaignId: uuid("campaign_id").notNull(),
    channel: text("channel").notNull(),
    bucket: text("bucket").notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("send_counters_unique_idx").on(
      t.organizationId,
      t.campaignId,
      t.channel,
      t.bucket,
    ),
  ],
);
