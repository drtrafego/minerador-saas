CREATE TABLE IF NOT EXISTS "minerador_scrapling"."agent_configs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" text NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "business_name" text,
  "business_info" text,
  "tone" text DEFAULT 'profissional e direto' NOT NULL,
  "system_prompt_override" text,
  "rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "handoff_keywords" jsonb DEFAULT '["humano","atendente","pessoa real","parar","stop"]'::jsonb NOT NULL,
  "preferred_provider" text DEFAULT 'auto' NOT NULL,
  "max_auto_replies" integer DEFAULT 6 NOT NULL,
  "model" text DEFAULT 'claude-sonnet-4-5' NOT NULL,
  "temperature" integer DEFAULT 70 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "agent_configs_organization_id_fk"
    FOREIGN KEY ("organization_id")
    REFERENCES "minerador_scrapling"."organization"("id")
    ON DELETE CASCADE
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "agent_configs_org_idx"
  ON "minerador_scrapling"."agent_configs" ("organization_id");
