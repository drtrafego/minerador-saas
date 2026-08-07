# Changelog

## 2026-04-20 - Fases 3 e 4

### Fase 1 (revamp scraping)
- `scrapling/` microservico Python FastAPI com Scrapling stealth
- Endpoints `/v1/linkedin/search`, `/v1/google-maps/search`, `/v1/instagram/search`
- Cliente TS `src/lib/clients/scrapling.ts` com auth por shared secret
- Scrapling como **default** para Google Maps, LinkedIn e Instagram
- Fallback automatico para Apify (Instagram) e Places API (Maps)
- LinkedIn destravado (antes retornava `[]`)
- Novo service `scrapling` em `docker-compose.yml` (rede interna)

### Fase 2 (pipeline + temperature + activities)
- Nova tabela `pipeline_stages` com seeds default
- Nova tabela `activities` (note/call/email/meeting/whatsapp/task)
- Colunas `temperature` (cold/warm/hot) e `pipeline_stage_id` em `leads`
- Rota `/pipeline` com Kanban drag-and-drop (`@dnd-kit`)
- Rota `/leads/[id]` com detalhe + timeline
- Componente `TemperatureBadge`
- Handler `qualify.batch` agora define `temperature` automaticamente do score
- Migration `0008_pipeline_and_activities.sql`

### Fase 3 (CSV + webhooks forms)
- `src/lib/csv.ts` com parser RFC 4180-ish
- Rota `/leads/import` com wizard (paste/upload, mapeamento, preview)
- Rota `GET /api/leads/export` com filtros (status, campanha)
- Rota `POST /api/webhooks/forms` generico para Typeform/Tally/Google Forms/Zapier
- Field matching bilingue (pt/en)
- `FORMS_WEBHOOK_SECRET` obrigatorio

### Fase 4 (inbound agent)
- Nova tabela `agent_configs` (por org)
- Rota `/settings/agent` com form completo
- Queue handler `agent.reply` com:
  - Handoff por palavra-chave
  - Limite de respostas automaticas
  - System prompt gerado de business_info + rules
  - Roteamento UazAPI ou Meta Cloud API
- Webhook WhatsApp enfileira agent.reply automaticamente
- Registro de custos (tokens + USD) por resposta
- Funcao `generateAgentReply` em `src/lib/clients/anthropic.ts`
- Migration `0009_agent_configs.sql`

### Correcoes de QA
- `pipeline_stages.is_won` e `is_lost` mudados de `text` para `boolean`
- `FORMS_WEBHOOK_SECRET` tornado obrigatorio (retorna 503 se nao configurado)
- `Linkedin` icon trocado por `LinkIcon` (lucide-react 1.8 nao expoe Linkedin)

### Novas dependencias
- `@dnd-kit/core` `^6.3.1`
- `@dnd-kit/sortable` `^10.0.0`
- `@dnd-kit/utilities` `^3.2.2`

### Novas vars de ambiente
- `SCRAPLING_URL`, `SCRAPLING_SHARED_SECRET`, `SCRAPLING_ENABLED`
- `SCRAPLING_USE_FOR_GOOGLE_MAPS`, `SCRAPLING_USE_FOR_INSTAGRAM`
- `SCRAPLING_LOG_LEVEL`, `SCRAPLING_MAX_CONCURRENCY`, `SCRAPLING_IG_SESSION_COOKIE`
- `FORMS_WEBHOOK_SECRET`
- `WHATSAPP_VERIFY_TOKEN` (ja existia, documentada)

### Build local verificado
- `pnpm typecheck`: 0 erros
- `pnpm build`: 28 rotas geradas
- `pnpm lint`: 0 erros, 3 warnings pre-existentes
