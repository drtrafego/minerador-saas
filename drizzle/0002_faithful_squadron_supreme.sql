ALTER TABLE "campaigns" ADD COLUMN "niche" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "qualification_prompt" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "qualification_model" text DEFAULT 'claude-sonnet-4-5' NOT NULL;