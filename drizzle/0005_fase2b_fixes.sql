-- credentials.ciphertext: bytea -> text (conteudo cifrado agora em base64 via AES-256-GCM no Node)
ALTER TABLE "credentials" ALTER COLUMN "ciphertext" SET DATA TYPE text USING encode("ciphertext", 'base64');--> statement-breakpoint

-- send_counters: coluna day (date) -> bucket (text) com preservacao dos valores
DROP INDEX IF EXISTS "send_counters_unique_idx";--> statement-breakpoint
ALTER TABLE "send_counters" ADD COLUMN "bucket" text;--> statement-breakpoint
UPDATE "send_counters" SET "bucket" = 'd:' || to_char("day", 'YYYY-MM-DD') WHERE "bucket" IS NULL;--> statement-breakpoint
ALTER TABLE "send_counters" ALTER COLUMN "bucket" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "send_counters" DROP COLUMN "day";--> statement-breakpoint
CREATE UNIQUE INDEX "send_counters_unique_idx" ON "send_counters" USING btree ("organization_id","campaign_id","channel","bucket");--> statement-breakpoint

-- campaigns.smart_follow_up: flag booleana para disparar follow up gerado por IA
ALTER TABLE "campaigns" ADD COLUMN "smart_follow_up" boolean DEFAULT false NOT NULL;
