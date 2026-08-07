ALTER TYPE "public"."outreach_thread_status" ADD VALUE 'finished';--> statement-breakpoint
ALTER TYPE "public"."outreach_thread_status" ADD VALUE 'failed';--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "initial_copy" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "follow_up_sequence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "external_message_id" text;--> statement-breakpoint
ALTER TABLE "outreach_messages" ADD COLUMN "error_reason" text;--> statement-breakpoint
ALTER TABLE "outreach_queue" ADD COLUMN "message_id" uuid;--> statement-breakpoint
ALTER TABLE "outreach_queue" ADD COLUMN "step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_threads" ADD COLUMN "current_step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_threads" ADD COLUMN "last_outbound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach_threads" ADD COLUMN "last_inbound_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outreach_threads" ADD COLUMN "external_thread_id" text;--> statement-breakpoint
ALTER TABLE "outreach_queue" ADD CONSTRAINT "outreach_queue_message_id_outreach_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."outreach_messages"("id") ON DELETE set null ON UPDATE no action;