-- Migration: indice unico parcial em outreach_messages para dedup atomico de inbound
-- Schema: minerador_scrapling
-- Gerada em: 2026-06-25
-- NAO APLICAR AUTOMATICAMENTE: aplicar manualmente via psql ou painel Neon
-- Propósito: garantir que o mesmo external_message_id nao seja inserido duas vezes
-- como inbound na mesma thread, mesmo com duas instancias processando o mesmo webhook retry.

CREATE UNIQUE INDEX IF NOT EXISTS outreach_messages_inbound_ext_msg_id_uidx
  ON minerador_scrapling.outreach_messages (thread_id, external_message_id)
  WHERE direction = 'inbound' AND external_message_id IS NOT NULL;
