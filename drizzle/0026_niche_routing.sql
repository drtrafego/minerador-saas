-- Roteamento de canal por nicho na automacao diaria: cada nicho sai por um
-- canal (whatsapp/email) com sua propria campanha. E campanha por item do
-- plano, para um plano de email carregar leads de nichos diferentes.
-- Aditivo e idempotente.

ALTER TABLE minerador_scrapling.automation_config
  ADD COLUMN IF NOT EXISTS niche_routing jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE minerador_scrapling.daily_send_plan_item
  ADD COLUMN IF NOT EXISTS outreach_campaign_id uuid;
