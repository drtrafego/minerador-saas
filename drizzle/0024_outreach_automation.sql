-- FASE 0 da automacao diaria de prospeccao (mineracao + warm-up de envio + disparo).
-- Migration PURAMENTE ADITIVA: apenas CREATE TYPE / CREATE TABLE / CREATE INDEX.
--
-- Tabelas:
--   - channel_warmup: curva de aquecimento de envio por org+canal (whatsapp/email).
--   - automation_config: liga/desliga mineracao, rotacao de combos, modo de disparo.
--   - daily_send_plan: plano diario de disparo por org+data+canal (cap/consumo/status).
--   - daily_send_plan_item: leads dentro de um plano diario.

DO $$ BEGIN
  CREATE TYPE "minerador_scrapling"."channel_warmup_channel" AS ENUM (
    'whatsapp',
    'email'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "minerador_scrapling"."automation_dispatch_mode" AS ENUM (
    'auto',
    'approval'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "minerador_scrapling"."daily_send_plan_status" AS ENUM (
    'pending',
    'approved',
    'rejected',
    'auto',
    'expired'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "minerador_scrapling"."daily_send_plan_item_status" AS ENUM (
    'planned',
    'sent',
    'skipped'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "minerador_scrapling"."channel_warmup" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id"    text        NOT NULL,
  "channel"            "minerador_scrapling"."channel_warmup_channel" NOT NULL,
  "enabled"            boolean     DEFAULT true NOT NULL,
  "started_at"         date        DEFAULT now() NOT NULL,
  "start_cap"          integer     DEFAULT 25 NOT NULL,
  "step_every_days"    numeric(5, 2)  DEFAULT '3.5' NOT NULL,
  "step_size"          integer     DEFAULT 25 NOT NULL,
  "max_cap"            integer     DEFAULT 250 NOT NULL,
  "cost_cap_usd"       numeric(10, 4) DEFAULT '3' NOT NULL,
  "cost_per_msg_usd"   numeric(10, 6) DEFAULT '0.008' NOT NULL,
  "updated_at"         timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "channel_warmup_organization_id_fk"
    FOREIGN KEY ("organization_id")
    REFERENCES "minerador_scrapling"."organization"("id")
    ON DELETE CASCADE
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "channel_warmup_org_channel_idx"
  ON "minerador_scrapling"."channel_warmup" ("organization_id", "channel");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "minerador_scrapling"."automation_config" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id"       text        NOT NULL,
  "mining_enabled"        boolean     DEFAULT false NOT NULL,
  "rotation_combos"       jsonb       DEFAULT '[]'::jsonb NOT NULL,
  "rotation_cursor"       integer     DEFAULT 0 NOT NULL,
  "dispatch_mode"         "minerador_scrapling"."automation_dispatch_mode" DEFAULT 'approval' NOT NULL,
  "whatsapp_campaign_id"  uuid,
  "email_campaign_id"     uuid,
  "notify_channel"        text,
  "notify_target"         text,
  "updated_at"            timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "automation_config_organization_id_fk"
    FOREIGN KEY ("organization_id")
    REFERENCES "minerador_scrapling"."organization"("id")
    ON DELETE CASCADE
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "automation_config_org_idx"
  ON "minerador_scrapling"."automation_config" ("organization_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "minerador_scrapling"."daily_send_plan" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id"       text        NOT NULL,
  "plan_date"             date        NOT NULL,
  "channel"               text        NOT NULL,
  "cap_dia"               integer     NOT NULL,
  "consumo"               integer     DEFAULT 0 NOT NULL,
  "planejado"             integer     DEFAULT 0 NOT NULL,
  "custo_estimado_usd"    numeric(10, 4),
  "status"                "minerador_scrapling"."daily_send_plan_status" DEFAULT 'pending' NOT NULL,
  "outreach_campaign_id"  uuid,
  "created_at"            timestamptz DEFAULT now() NOT NULL,
  "decided_at"            timestamptz,
  CONSTRAINT "daily_send_plan_organization_id_fk"
    FOREIGN KEY ("organization_id")
    REFERENCES "minerador_scrapling"."organization"("id")
    ON DELETE CASCADE
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "daily_send_plan_org_date_channel_idx"
  ON "minerador_scrapling"."daily_send_plan" ("organization_id", "plan_date", "channel");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "minerador_scrapling"."daily_send_plan_item" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id"     uuid        NOT NULL,
  "lead_id"     uuid        NOT NULL,
  "status"      "minerador_scrapling"."daily_send_plan_item_status" DEFAULT 'planned' NOT NULL,
  "created_at"  timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "daily_send_plan_item_plan_id_fk"
    FOREIGN KEY ("plan_id")
    REFERENCES "minerador_scrapling"."daily_send_plan"("id")
    ON DELETE CASCADE
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "daily_send_plan_item_plan_idx"
  ON "minerador_scrapling"."daily_send_plan_item" ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_send_plan_item_lead_idx"
  ON "minerador_scrapling"."daily_send_plan_item" ("lead_id");
