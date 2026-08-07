import { sql } from "drizzle-orm";
import {
  text,
  timestamp,
  uuid,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";
import { organization } from "./auth";

export const miningStatusEnum = ms.enum("campaign_status", [
  "draft",
  "active",
  "paused",
  "archived",
]);

export const miningSourceTypeEnum = ms.enum("campaign_source_type", [
  "google_places",
  "instagram_hashtag",
  "instagram_profile",
  "manual",
  "linkedin_search",
]);

export const minings = ms.table(
  "minings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    niche: text("niche"),
    status: miningStatusEnum("status").notNull().default("draft"),
    icp: jsonb("icp").$type<Record<string, unknown>>(),
    qualificationPrompt: text("qualification_prompt"),
    qualificationModel: text("qualification_model")
      .notNull()
      .default("claude-sonnet-4-5"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaigns_org_status_idx").on(t.organizationId, t.status)],
);

export const miningSources = ms.table(
  "mining_sources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    miningId: uuid("mining_id")
      .notNull()
      .references(() => minings.id, { onDelete: "cascade" }),
    type: miningSourceTypeEnum("type").notNull(),
    config: jsonb("config").notNull().$type<Record<string, unknown>>(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaign_sources_org_campaign_idx").on(t.organizationId, t.miningId)],
);
