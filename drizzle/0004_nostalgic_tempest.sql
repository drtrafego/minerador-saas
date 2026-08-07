CREATE TYPE "public"."browser_run_status" AS ENUM('ok', 'failed', 'blocked', 'needs_relogin');--> statement-breakpoint
ALTER TYPE "public"."credential_provider" ADD VALUE 'linkedin_session';--> statement-breakpoint
ALTER TYPE "public"."campaign_source_type" ADD VALUE 'linkedin_search';--> statement-breakpoint
ALTER TYPE "public"."lead_source" ADD VALUE 'linkedin';--> statement-breakpoint
ALTER TYPE "public"."outreach_channel" ADD VALUE 'linkedin_dm';--> statement-breakpoint
CREATE TABLE "browser_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"credential_id" uuid,
	"channel" "outreach_channel" NOT NULL,
	"status" "browser_run_status" NOT NULL,
	"thread_id" uuid,
	"message_id" uuid,
	"duration_ms" integer,
	"error_reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "company" text;--> statement-breakpoint
ALTER TABLE "browser_runs" ADD CONSTRAINT "browser_runs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_runs" ADD CONSTRAINT "browser_runs_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_runs" ADD CONSTRAINT "browser_runs_thread_id_outreach_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."outreach_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_runs" ADD CONSTRAINT "browser_runs_message_id_outreach_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."outreach_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "browser_runs_org_channel_created_idx" ON "browser_runs" USING btree ("organization_id","channel","created_at" DESC NULLS LAST);