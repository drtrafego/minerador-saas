import { sql } from "drizzle-orm";
import {
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";
import { organization } from "./auth";
import { credentials } from "./credentials";
import { outreachChannelEnum, outreachThreads, outreachMessages } from "./outreach";

export const browserRunStatusEnum = ms.enum("browser_run_status", [
  "ok",
  "failed",
  "blocked",
  "needs_relogin",
]);

export const browserRuns = ms.table(
  "browser_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    credentialId: uuid("credential_id").references(() => credentials.id, {
      onDelete: "set null",
    }),
    channel: outreachChannelEnum("channel").notNull(),
    status: browserRunStatusEnum("status").notNull(),
    threadId: uuid("thread_id").references(() => outreachThreads.id, {
      onDelete: "set null",
    }),
    messageId: uuid("message_id").references(() => outreachMessages.id, {
      onDelete: "set null",
    }),
    durationMs: integer("duration_ms"),
    errorReason: text("error_reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("browser_runs_org_channel_created_idx").on(
      t.organizationId,
      t.channel,
      t.createdAt.desc(),
    ),
  ],
);
