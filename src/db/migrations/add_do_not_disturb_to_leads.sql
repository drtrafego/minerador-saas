-- Migration: adiciona coluna do_not_disturb na tabela leads
-- Schema: minerador_scrapling
-- Gerada em: 2026-06-25
-- NAO APLICAR AUTOMATICAMENTE: aplicar manualmente via psql ou painel Neon

ALTER TABLE minerador_scrapling.leads
  ADD COLUMN IF NOT EXISTS do_not_disturb boolean NOT NULL DEFAULT false;

-- Indice opcional para filtrar leads com opt-out em consultas de campanha
CREATE INDEX IF NOT EXISTS leads_org_dnd_idx
  ON minerador_scrapling.leads (organization_id, do_not_disturb)
  WHERE do_not_disturb = true;
