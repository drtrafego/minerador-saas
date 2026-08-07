import { sql } from "drizzle-orm";
import {
  text,
  timestamp,
  uuid,
  integer,
  index,
  uniqueIndex,
  boolean,
} from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";
import { organization } from "./auth";
import { leads } from "./leads";

export const activityTypeEnum = ms.enum("activity_type", [
  "note",
  "call",
  "email",
  "meeting",
  "whatsapp",
  "task",
]);

export const pipelineStages = ms.table(
  "pipeline_stages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("#64748b"),
    position: integer("position").notNull(),
    isWon: boolean("is_won").notNull().default(false),
    isLost: boolean("is_lost").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("pipeline_stages_org_position_idx").on(t.organizationId, t.position),
    uniqueIndex("pipeline_stages_org_name_idx").on(t.organizationId, t.name),
  ],
);

export const activities = ms.table(
  "activities",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    type: activityTypeEnum("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activities_lead_idx").on(t.leadId),
    index("activities_org_due_idx").on(t.organizationId, t.dueAt),
  ],
);

export const DEFAULT_PIPELINE_STAGES: Array<{
  name: string;
  color: string;
  position: number;
  isWon?: boolean;
  isLost?: boolean;
}> = [
  { name: "Novo", color: "#64748b", position: 0 },
  { name: "Contatado", color: "#0ea5e9", position: 1 },
  { name: "Qualificado", color: "#8b5cf6", position: 2 },
  { name: "Proposta", color: "#f59e0b", position: 3 },
  { name: "Fechado", color: "#10b981", position: 4, isWon: true },
  { name: "Perdido", color: "#ef4444", position: 5, isLost: true },
];
