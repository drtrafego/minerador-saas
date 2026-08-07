-- FASE 4 da separacao mineracao/abordagem.
-- Renomeia a entidade hibrida "campaigns" para "minings" (somente mineracao).
-- A abordagem ja vive em outreach_campaigns/campaign_leads (Fases 1-3).
--
-- Migration de RENAME puro: preserva todos os dados (1 mineracao, 27 leads,
-- 2 threads). NAO faz DROP de colunas (initial_copy/follow_up_sequence/
-- daily_limit ficam para a Fase 5). FKs acompanham o rename da tabela
-- automaticamente no Postgres. Enums e indices mantem os nomes antigos
-- (renomear nome de indice/constraint nao e obrigatorio).

ALTER TABLE "minerador_scrapling"."campaigns" RENAME TO "minings";--> statement-breakpoint
ALTER TABLE "minerador_scrapling"."campaign_sources" RENAME TO "mining_sources";--> statement-breakpoint

ALTER TABLE "minerador_scrapling"."mining_sources" RENAME COLUMN "campaign_id" TO "mining_id";--> statement-breakpoint
ALTER TABLE "minerador_scrapling"."leads" RENAME COLUMN "campaign_id" TO "mining_id";--> statement-breakpoint
ALTER TABLE "minerador_scrapling"."scraping_jobs" RENAME COLUMN "campaign_id" TO "mining_id";--> statement-breakpoint
ALTER TABLE "minerador_scrapling"."qualification_jobs" RENAME COLUMN "campaign_id" TO "mining_id";--> statement-breakpoint
ALTER TABLE "minerador_scrapling"."outreach_threads" RENAME COLUMN "campaign_id" TO "mining_id";
