-- Adiciona contadores de reengajamento na tabela leads.
--
-- reengage_followup_count: quantas "cutucadas" o bot ja enviou para este lead
--   na janela ativa de 24h. Reseta implicitamente quando a janela vence (o lead
--   responde e o ciclo recomeça). Maximo de 2 por janela (FU1 em ~1h, FU2 em ~23h).
--
-- reengage_last_at: timestamp da ultima avaliacao de reengage (mesmo que o LLM
--   decida NAO_ENVIAR). Usado para garantir no maximo 1 chamada de LLM por hora
--   por lead, independentemente do resultado.

ALTER TABLE "minerador_scrapling"."leads"
  ADD COLUMN IF NOT EXISTS "reengage_followup_count" integer NOT NULL DEFAULT 0;

ALTER TABLE "minerador_scrapling"."leads"
  ADD COLUMN IF NOT EXISTS "reengage_last_at" timestamptz;
