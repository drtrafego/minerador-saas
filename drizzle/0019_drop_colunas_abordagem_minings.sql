-- FASE 5 (limpeza) da separacao mineracao/abordagem.
-- Remove da tabela "minings" as 4 colunas que eram do modelo hibrido antigo e
-- pertenciam a abordagem (hoje vivem em outreach_campaigns/campaign_leads):
-- initial_copy, follow_up_sequence, smart_follow_up e daily_limit.
--
-- O fluxo de envio agora e o campaign.send (outreach_campaigns). As filas e
-- handlers antigos (outreach.enqueue / outreach.send / outreach.tick) foram
-- removidos do worker, entao nada mais le essas colunas.
--
-- DROP idempotente com IF EXISTS: seguro de reaplicar. Nenhum dado relevante e
-- perdido porque a abordagem ja foi migrada nas Fases 1-4.

ALTER TABLE "minerador_scrapling"."minings" DROP COLUMN IF EXISTS "initial_copy";--> statement-breakpoint
ALTER TABLE "minerador_scrapling"."minings" DROP COLUMN IF EXISTS "follow_up_sequence";--> statement-breakpoint
ALTER TABLE "minerador_scrapling"."minings" DROP COLUMN IF EXISTS "smart_follow_up";--> statement-breakpoint
ALTER TABLE "minerador_scrapling"."minings" DROP COLUMN IF EXISTS "daily_limit";
