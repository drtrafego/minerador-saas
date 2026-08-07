-- Adiciona colunas de modelo por finalidade na tabela agent_configs.
-- followUpModel: modelo usado em generateSmartFollowUp (follow-up inteligente).
-- knowledgeModel: modelo usado em ingestDocument (RAG/treinamento).
-- Ambas sao nullable; NULL significa usar o default automatico do provider.

ALTER TABLE "minerador_scrapling"."agent_configs"
  ADD COLUMN IF NOT EXISTS "follow_up_model" text;

ALTER TABLE "minerador_scrapling"."agent_configs"
  ADD COLUMN IF NOT EXISTS "knowledge_model" text;
