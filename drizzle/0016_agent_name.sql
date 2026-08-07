-- Adiciona coluna agent_name em agent_configs para nomear a agente por org.
-- Default 'Isabela': orgs que nao preencherem o campo usam esse nome automaticamente.

ALTER TABLE "minerador_scrapling"."agent_configs"
  ADD COLUMN IF NOT EXISTS "agent_name" text NOT NULL DEFAULT 'Isabela';
