-- FASE 1 da separacao mineracao/abordagem.
-- Cria a estrutura NOVA de abordagem por cima, sem tocar em campaigns/leads/outreach existentes.
-- Migration PURAMENTE ADITIVA: apenas CREATE TYPE / CREATE TABLE / CREATE INDEX.
--
-- Tabelas:
--   - outreach_campaigns: entidade final de campanha de abordagem (separada da campaigns hibrida atual).
--   - campaign_leads: junction campanha de abordagem x lead, com progresso por lead.

DO $$ BEGIN
  CREATE TYPE "minerador_scrapling"."outreach_campaign_channel" AS ENUM (
    'email',
    'whatsapp',
    'instagram_dm',
    'linkedin_dm'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "minerador_scrapling"."campaign_lead_status" AS ENUM (
    'enqueued',
    'sent',
    'failed',
    'replied',
    'skipped'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "minerador_scrapling"."outreach_campaigns" (
  "id"                        uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id"           text        NOT NULL,
  "name"                      text        NOT NULL,
  "channel"                   "minerador_scrapling"."outreach_campaign_channel" NOT NULL,
  "sequence_json"             jsonb       DEFAULT '[]'::jsonb NOT NULL,
  "smart_follow_up"           boolean     DEFAULT false NOT NULL,
  "daily_cap"                 integer     DEFAULT 50 NOT NULL,
  "send_interval_min_seconds" integer     DEFAULT 60 NOT NULL,
  "send_interval_max_seconds" integer     DEFAULT 180 NOT NULL,
  "active"                    boolean     DEFAULT true NOT NULL,
  "send_paused"               boolean     DEFAULT false NOT NULL,
  "created_at"                timestamptz DEFAULT now() NOT NULL,
  "updated_at"                timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "outreach_campaigns_organization_id_fk"
    FOREIGN KEY ("organization_id")
    REFERENCES "minerador_scrapling"."organization"("id")
    ON DELETE CASCADE
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "outreach_campaigns_org_idx"
  ON "minerador_scrapling"."outreach_campaigns" ("organization_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "minerador_scrapling"."campaign_leads" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id"      text        NOT NULL,
  "outreach_campaign_id" uuid        NOT NULL,
  "lead_id"              uuid        NOT NULL,
  "external_ref"         text,
  "status"               "minerador_scrapling"."campaign_lead_status" DEFAULT 'enqueued' NOT NULL,
  "step"                 integer     DEFAULT 0 NOT NULL,
  "contacted_at"         timestamptz,
  "replied_at"           timestamptz,
  "last_error"           text,
  "created_at"           timestamptz DEFAULT now() NOT NULL,
  "updated_at"           timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_leads_organization_id_fk"
    FOREIGN KEY ("organization_id")
    REFERENCES "minerador_scrapling"."organization"("id")
    ON DELETE CASCADE,
  CONSTRAINT "campaign_leads_outreach_campaign_id_fk"
    FOREIGN KEY ("outreach_campaign_id")
    REFERENCES "minerador_scrapling"."outreach_campaigns"("id")
    ON DELETE CASCADE,
  CONSTRAINT "campaign_leads_lead_id_fk"
    FOREIGN KEY ("lead_id")
    REFERENCES "minerador_scrapling"."leads"("id")
    ON DELETE CASCADE
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "campaign_leads_campaign_ref_idx"
  ON "minerador_scrapling"."campaign_leads" ("outreach_campaign_id", "external_ref");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_leads_lead_idx"
  ON "minerador_scrapling"."campaign_leads" ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "campaign_leads_org_idx"
  ON "minerador_scrapling"."campaign_leads" ("organization_id");
