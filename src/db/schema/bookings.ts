import { sql } from "drizzle-orm";
import { text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";
import { organization } from "./auth";
import { leads } from "./leads";

export const callBookingStatusEnum = ms.enum("call_booking_status", [
  "scheduled",
  "completed",
  "no_show",
  "canceled",
]);

// Persiste agendamentos de call criados pelo agente (tool book_meeting) e pelo CRM.
// Tabela ja existente no banco via migration 0014_call_bookings.sql.
export const callBookings = ms.table(
  "call_bookings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    googleEventId: text("google_event_id"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    attendeeEmail: text("attendee_email"),
    status: callBookingStatusEnum("status").notNull().default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("call_bookings_lead_idx").on(t.leadId),
    index("call_bookings_org_idx").on(t.organizationId),
    index("call_bookings_scheduled_idx").on(t.scheduledAt),
  ],
);
