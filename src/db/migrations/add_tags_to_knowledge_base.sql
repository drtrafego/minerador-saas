-- Adiciona coluna tags (nullable) em knowledge_base.
-- Executar no banco Neon apos deploy: psql $DATABASE_URL -f <este arquivo>
-- Ou via painel Neon SQL Editor.
ALTER TABLE minerador_scrapling.knowledge_base
  ADD COLUMN IF NOT EXISTS tags text;
