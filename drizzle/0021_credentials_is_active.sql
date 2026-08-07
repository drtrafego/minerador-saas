-- Marca de credencial ativa por (org, provider). Aditivo e retrocompativel:
-- default false; quando nenhuma esta marcada, o backend usa a mais recente.
ALTER TABLE "minerador_scrapling"."credentials"
  ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT false;

-- Indice parcial garante no maximo UMA credencial ativa por (org, provider).
CREATE UNIQUE INDEX IF NOT EXISTS "credentials_one_active_per_provider_idx"
  ON "minerador_scrapling"."credentials" ("organization_id", "provider")
  WHERE "is_active" = true;
