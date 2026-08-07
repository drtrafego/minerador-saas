-- Indice unico parcial para dedup atomico de mensagens inbound.
--
-- Garante que (thread_id, external_message_id) seja unico dentro das mensagens
-- inbound. NULLs em external_message_id nao violam o indice (comportamento
-- padrao do Postgres), entao mensagens sem ID nao sao afetadas.
--
-- Usado por:
--   - src/app/api/webhooks/whatsapp/route.ts  (ja usa .onConflictDoNothing())
--   - src/app/api/webhooks/email-inbound/route.ts  (corrigido para o mesmo padrao)

CREATE UNIQUE INDEX IF NOT EXISTS "outreach_messages_inbound_msg_id_idx"
  ON "minerador_scrapling"."outreach_messages" (thread_id, external_message_id)
  WHERE direction = 'inbound';
