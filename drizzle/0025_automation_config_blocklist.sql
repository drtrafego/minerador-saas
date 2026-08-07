-- PARTE B da Fase 2 da automacao diaria de prospeccao: blocklist por org em
-- automation_config (clientes proprios que o dono nao quer prospectar, ex.
-- "Gramado Plazza"). Termos casam case-insensitive/contains contra
-- nome/telefone/@ do lead no ingest; lead que bater entra ja com
-- do_not_disturb=true.
ALTER TABLE "minerador_scrapling"."automation_config"
  ADD COLUMN IF NOT EXISTS "blocklist" jsonb DEFAULT '[]'::jsonb NOT NULL;
