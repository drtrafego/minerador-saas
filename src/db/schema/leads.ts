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
import { minings } from "./minings";

export const leadSourceEnum = ms.enum("lead_source", [
  "google_places",
  "instagram",
  "manual",
  "import",
  "linkedin",
]);

export const leadQualificationStatusEnum = ms.enum("lead_qualification_status", [
  "pending",
  "queued",
  "qualified",
  "disqualified",
  "needs_review",
]);

export const leadTemperatureEnum = ms.enum("lead_temperature", [
  "cold",
  "warm",
  "hot",
]);

export const leads = ms.table(
  "leads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    miningId: uuid("mining_id").references(() => minings.id, {
      onDelete: "set null",
    }),
    source: leadSourceEnum("source").notNull(),
    externalId: text("external_id").notNull(),
    displayName: text("display_name").notNull(),
    handle: text("handle"),
    website: text("website"),
    phone: text("phone"),
    email: text("email"),
    city: text("city"),
    region: text("region"),
    country: text("country"),
    linkedinUrl: text("linkedin_url"),
    headline: text("headline"),
    company: text("company"),
    rawData: jsonb("raw_data").notNull().$type<Record<string, unknown>>(),
    qualificationStatus: leadQualificationStatusEnum("qualification_status")
      .notNull()
      .default("pending"),
    qualificationReason: text("qualification_reason"),
    qualificationScore: integer("qualification_score"),
    qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
    temperature: leadTemperatureEnum("temperature"),
    doNotDisturb: boolean("do_not_disturb").notNull().default(false),
    pipelineStageId: uuid("pipeline_stage_id"),
    reengageFollowupCount: integer("reengage_followup_count").notNull().default(0),
    reengageLastAt: timestamp("reengage_last_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("leads_org_source_external_idx").on(
      t.organizationId,
      t.source,
      t.externalId,
    ),
    index("leads_org_campaign_status_idx").on(
      t.organizationId,
      t.miningId,
      t.qualificationStatus,
    ),
  ],
);
