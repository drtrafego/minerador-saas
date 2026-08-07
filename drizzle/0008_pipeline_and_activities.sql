CREATE TYPE "minerador_scrapling"."lead_temperature" AS ENUM ('cold', 'warm', 'hot');--> statement-breakpoint
CREATE TYPE "minerador_scrapling"."activity_type" AS ENUM ('note', 'call', 'email', 'meeting', 'whatsapp', 'task');--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "minerador_scrapling"."pipeline_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "color" text DEFAULT '#64748b' NOT NULL,
  "position" integer NOT NULL,
  "is_won" boolean DEFAULT false NOT NULL,
  "is_lost" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "pipeline_stages_organization_id_fk"
    FOREIGN KEY ("organization_id")
    REFERENCES "minerador_scrapling"."organization"("id")
    ON DELETE CASCADE
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "pipeline_stages_org_position_idx"
  ON "minerador_scrapling"."pipeline_stages" ("organization_id", "position");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_stages_org_name_idx"
  ON "minerador_scrapling"."pipeline_stages" ("organization_id", "name");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "minerador_scrapling"."activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "lead_id" uuid NOT NULL,
  "type" "minerador_scrapling"."activity_type" NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "due_at" timestamptz,
  "completed_at" timestamptz,
  "created_by_user_id" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "activities_organization_id_fk"
    FOREIGN KEY ("organization_id")
    REFERENCES "minerador_scrapling"."organization"("id")
    ON DELETE CASCADE,
  CONSTRAINT "activities_lead_id_fk"
    FOREIGN KEY ("lead_id")
    REFERENCES "minerador_scrapling"."leads"("id")
    ON DELETE CASCADE,
  CONSTRAINT "activities_created_by_user_id_fk"
    FOREIGN KEY ("created_by_user_id")
    REFERENCES "minerador_scrapling"."user"("id")
    ON DELETE SET NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "activities_lead_idx"
  ON "minerador_scrapling"."activities" ("lead_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activities_org_due_idx"
  ON "minerador_scrapling"."activities" ("organization_id", "due_at");--> statement-breakpoint

ALTER TABLE "minerador_scrapling"."leads"
  ADD COLUMN IF NOT EXISTS "temperature" "minerador_scrapling"."lead_temperature";--> statement-breakpoint
ALTER TABLE "minerador_scrapling"."leads"
  ADD COLUMN IF NOT EXISTS "pipeline_stage_id" uuid;--> statement-breakpoint

ALTER TABLE "minerador_scrapling"."leads"
  ADD CONSTRAINT "leads_pipeline_stage_id_fk"
  FOREIGN KEY ("pipeline_stage_id")
  REFERENCES "minerador_scrapling"."pipeline_stages"("id")
  ON DELETE SET NULL;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "leads_pipeline_stage_idx"
  ON "minerador_scrapling"."leads" ("pipeline_stage_id");
