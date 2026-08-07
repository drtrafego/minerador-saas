-- Abordagem fria via WhatsApp oficial (Meta Cloud API) exige template aprovado na WABA.
-- Esta migration adiciona, na campanha de abordagem, os campos do template escolhido.
-- Migration PURAMENTE ADITIVA: apenas ADD COLUMN IF NOT EXISTS.
--
--   meta_template_name: nome do template aprovado na Meta (ex: cold_outreach_v1).
--   meta_template_lang: codigo de idioma do template (ex: pt_BR).
--   meta_template_vars: VarSpec[] serializado em JSON, mapeando {{1}},{{2}}... para
--                       campo do lead ("field") ou texto fixo ("fixed").
--   meta_template_body: corpo aprovado do template, usado para renderizar o texto
--                       real que o lead recebe e exibir no historico/inbox.

ALTER TABLE "minerador_scrapling"."outreach_campaigns"
  ADD COLUMN IF NOT EXISTS "meta_template_name" text;--> statement-breakpoint

ALTER TABLE "minerador_scrapling"."outreach_campaigns"
  ADD COLUMN IF NOT EXISTS "meta_template_lang" text DEFAULT 'pt_BR';--> statement-breakpoint

ALTER TABLE "minerador_scrapling"."outreach_campaigns"
  ADD COLUMN IF NOT EXISTS "meta_template_vars" text;--> statement-breakpoint

ALTER TABLE "minerador_scrapling"."outreach_campaigns"
  ADD COLUMN IF NOT EXISTS "meta_template_body" text;
