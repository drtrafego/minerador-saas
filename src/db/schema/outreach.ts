import { sql } from "drizzle-orm";
import {
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";
import { organization } from "./auth";
import { minings } from "./minings";
import { leads } from "./leads";

export const outreachChannelEnum = ms.enum("outreach_channel", [
  "instagram_dm",
  "email",
  "linkedin_dm",
  "whatsapp",
]);

export const outreachThreadStatusEnum = ms.enum("outreach_thread_status", [
  "queued",
  "active",
  "awaiting_reply",
  "replied",
  "booked",
  "dead",
  "finished",
  "failed",
]);

export const outreachMessageDirectionEnum = ms.enum("outreach_message_direction", [
  "outbound",
  "inbound",
]);

export const outreachMessageStatusEnum = ms.enum("outreach_message_status", [
  "pending",
  "sent",
  "delivered",
  "failed",
  "received",
]);

export const outreachQueueStatusEnum = ms.enum("outreach_queue_status", [
  "pending",
  "processing",
  "sent",
  "failed",
  "cancelled",
]);

export const outreachThreads = ms.table(
  "outreach_threads",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    miningId: uuid("mining_id").references(() => minings.id, {
      onDelete: "set null",
    }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    channel: outreachChannelEnum("channel").notNull(),
    status: outreachThreadStatusEnum("status").notNull().default("queued"),
    currentStep: integer("current_step").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    lastOutboundAt: timestamp("last_outbound_at", { withTimezone: true }),
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
    externalThreadId: text("external_thread_id"),
    followupCount: integer("followup_count").notNull().default(0),
    botPaused: boolean("bot_paused").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("outreach_threads_org_campaign_status_idx").on(
      t.organizationId,
      t.miningId,
      t.status,
    ),
    index("outreach_threads_org_lead_idx").on(t.organizationId, t.leadId),
  ],
);

export const outreachMessages = ms.table(
  "outreach_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => outreachThreads.id, { onDelete: "cascade" }),
    direction: outreachMessageDirectionEnum("direction").notNull(),
    status: outreachMessageStatusEnum("status").notNull().default("pending"),
    step: integer("step").notNull().default(0),
    subject: text("subject"),
    body: text("body").notNull(),
    externalMessageId: text("external_message_id"),
    errorReason: text("error_reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("outreach_messages_org_thread_idx").on(t.organizationId, t.threadId),
  ],
);

export const outreachQueue = ms.table(
  "outreach_queue",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => outreachThreads.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => outreachMessages.id, {
      onDelete: "set null",
    }),
    channel: outreachChannelEnum("channel").notNull(),
    step: integer("step").notNull().default(0),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    status: outreachQueueStatusEnum("status").notNull().default("pending"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("outreach_queue_org_status_scheduled_idx").on(
      t.organizationId,
      t.status,
      t.scheduledAt,
    ),
  ],
);
