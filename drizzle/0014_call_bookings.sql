-- Cria enum de status de agendamento de call e tabela call_bookings.
-- A tabela persiste bookings criados pelo agente (tool book_meeting) e pelo CRM.
-- Inclui organization_id para suporte multi-tenant.

DO $$ BEGIN
  CREATE TYPE "minerador_scrapling"."call_booking_status" AS ENUM (
    'scheduled',
    'completed',
    'no_show',
    'canceled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "minerador_scrapling"."call_bookings" (
  "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" text        NOT NULL REFERENCES "minerador_scrapling"."organization"("id") ON DELETE CASCADE,
  "lead_id"         uuid        NOT NULL REFERENCES "minerador_scrapling"."leads"("id") ON DELETE CASCADE,
  "google_event_id" text,
  "scheduled_at"    timestamptz NOT NULL,
  "attendee_email"  text,
  "status"          "minerador_scrapling"."call_booking_status" NOT NULL DEFAULT 'scheduled',
  "created_at"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "call_bookings_lead_idx"      ON "minerador_scrapling"."call_bookings" ("lead_id");
CREATE INDEX IF NOT EXISTS "call_bookings_org_idx"       ON "minerador_scrapling"."call_bookings" ("organization_id");
CREATE INDEX IF NOT EXISTS "call_bookings_scheduled_idx" ON "minerador_scrapling"."call_bookings" ("scheduled_at");
