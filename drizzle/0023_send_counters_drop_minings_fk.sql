-- Remove a FK de send_counters.campaign_id -> minings(id). Resquicio da
-- refatoracao campaigns->minings: o contador guarda o id de outreach_campaigns
-- (abordagem), que nao existe em minings, causando "violates foreign key" no
-- incrementSendCount e quebrando o disparo de campanhas de email/whatsapp.
ALTER TABLE "minerador_scrapling"."send_counters"
  DROP CONSTRAINT IF EXISTS "send_counters_campaign_id_campaigns_id_fk";
