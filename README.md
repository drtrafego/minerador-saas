# Minerador SaaS

SaaS multi-tenant de prospecção ativa. Minera leads em **Google Maps, LinkedIn e Instagram** via Scrapling stealth (Python FastAPI), qualifica cada lead com Claude, envia a abordagem por Email, WhatsApp, Instagram DM e LinkedIn DM, e faz follow up automático. Responde os leads que respondem (inbound) com um agente Claude. Multi-tenant desde o dia 1.

Este repositório traz o código completo mais esta documentação de como tudo funciona. Nenhuma chave, senha ou dado pessoal está versionado: toda credencial entra por variável de ambiente (veja `.env.example`).

> **Primeira vez aqui? Comece pelo [Manual de Instalação](INSTALACAO.md)**, com o passo a passo e onde pegar cada chave.

## Como funciona (o fluxo)

```
Campanha criada
  -> scrape.run       (Scrapling minera Google Maps / LinkedIn / Instagram)
  -> scrape.ingest    (normaliza e salva os leads, com dedup)
  -> qualify.batch    (Claude classifica: qualified / disqualified / needs_review)
  -> outreach.enqueue (agenda a mensagem no canal certo por nicho)
  -> outreach.send    (dispara via WhatsApp / Email / LinkedIn / Instagram)
  -> lead responde -> webhook -> agent.reply (o bot Claude responde)
```

Cada etapa é uma fila (pg-boss). Um passo alimenta o próximo, e tudo é retomável: se um job falha, ele volta para a fila sem perder o trabalho já feito. O dedup por `(organização, fonte, id_externo)` impede o mesmo lead entrar duas vezes.

Cada fonte entrega um tipo de contato e por isso alimenta um canal:

| Fonte | O que entrega | Canal natural |
|-------|---------------|---------------|
| Google Maps | Telefone e, muitas vezes, o site (de onde se extrai email) | WhatsApp e Email |
| Instagram | O link da bio (de onde se chega ao site e ao email) | Email |
| LinkedIn | Perfil profissional e, quando público, o site | Email |

## Stack

- Next.js (App Router, Server Components, Server Actions)
- TypeScript strict
- Tailwind CSS v4 + shadcn/ui (tema dark)
- Drizzle ORM + PostgreSQL
- Autenticação com organização (multi-tenant)
- pg-boss para filas (dentro do próprio Postgres)
- Criptografia AES-256-GCM das credenciais por organização
- **Scrapling** (Python FastAPI) para scraping stealth
- **@dnd-kit** para o Kanban drag-and-drop
- pnpm

## Features

### Mineração
- **Google Maps**: Scrapling (Playwright, com rolagem do feed)
- **LinkedIn**: Scrapling via busca por dork
- **Instagram**: Scrapling (fetcher stealth)
- **Import CSV**: `/leads/import` com wizard de mapeamento
- **Webhook de formulários**: `/api/webhooks/forms` (Typeform, Tally, Google Forms, Zapier)

### Qualificação
- Claude com tool use (decisão, nota e justificativa)
- Temperatura automática do lead a partir da nota (quente, morno, frio)
- Modelo configurável por campanha

### Pipeline
- `/pipeline` com Kanban drag-and-drop
- Etapas customizáveis por organização
- Timeline de atividades por lead em `/leads/[id]`

### Outreach
- **Email**, **Instagram DM**, **LinkedIn DM** e **WhatsApp** (múltiplos provedores)
- Warm-up por canal: o volume diário sobe aos poucos, para não queimar o remetente
- Cadência: primeiro toque mais follow-up; reengajamento para quem some
- Horário de início com variação anti-padrão
- Enriquecimento de email: abre o site do lead (incluindo agregadores de bio-link tipo Linktree), extrai o email e valida o domínio por MX

### Agente inbound
- Responde WhatsApp automaticamente usando Claude
- Cria lead e thread sozinho quando chega mensagem de um número novo
- System prompt customizável em `/settings/agent`
- Palavras de handoff pausam o agente; limite de respostas automáticas por thread

### Export
- `/api/leads/export` retorna CSV com filtros (status, campanha)

## Rodar em desenvolvimento

Pré-requisitos: Node 20+, pnpm, Docker Desktop.

```bash
cp .env.example .env.local
# preencha os secrets (gere com: openssl rand -hex 32)

docker compose -f docker-compose.dev.yml up -d   # Postgres + Scrapling
pnpm install
pnpm db:migrate                                  # aplica o schema
pnpm dev
```

Em outro terminal:
```bash
pnpm worker                                      # processa as filas pg-boss
```

O `docker-compose.dev.yml` sobe o Scrapling (FastAPI) junto com o Postgres. A primeira build do container Scrapling demora alguns minutos (instala Playwright e Chromium); as próximas são rápidas.

Acesse `http://localhost:3000`, crie a conta, crie a organização e vá em `/settings/credentials` para cadastrar as credenciais.

## Rodar em produção

```bash
cp .env.example .env
# preencha todos os secrets

docker compose up -d --build
pnpm db:migrate                                  # uma vez
```

Sobe `postgres`, `app`, `worker` e `scrapling`. O script `scripts/setup-server.sh` automatiza a primeira instalação num servidor (instala Docker, clona o repo, pede as variáveis de ambiente de forma interativa e sobe os containers).

Atualizar o servidor após um push:

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Importante: a `CREDENTIALS_ENCRYPTION_KEY` precisa ser idêntica em todos os ambientes. Se divergir, a qualificação e o bot falham ao descriptografar as credenciais da organização.

## Primeira campanha

1. Cadastre as credenciais em `/settings/credentials`:
   - `anthropic` (obrigatório): a chave da Anthropic
   - WhatsApp, Gmail, LinkedIn ou Instagram, conforme o canal que for usar
2. Em `/campaigns`, crie uma nova campanha
3. Escolha a fonte: Google Maps, Instagram ou LinkedIn
4. Ajuste o prompt de qualificação (o perfil de cliente ideal)
5. Adicione a sequência de follow-up
6. Crie e comece. Acompanhe em `/campaigns/[id]`

## Estrutura

```
src/
  app/
    (auth)/              sign-in, sign-up, onboarding
    (app)/
      dashboard/
      campaigns/         CRUD e wizard
      leads/             listagem, detalhe, import
      pipeline/          Kanban drag-and-drop
      inbox/             conversas de outreach
      settings/
        credentials/     chaves e sessões
        agent/           config do agente inbound
    api/
      leads/export/      export CSV
      webhooks/          whatsapp (Meta + UazAPI), forms, status de email
      cron/              orquestração diária (daily-plan)
  components/            ui (shadcn), pipeline (kanban, timeline), leads
  db/schema/             auth, credentials, campaigns, leads,
                         outreach, jobs, events, pipeline, agent
  lib/
    auth/                server, client, guards
    clients/             anthropic, scrapling, gmail, whatsapp, etc.
    queue/               client, types
      handlers/          scrape, ingest, qualify, outreach-*,
                         agent-reply, daily-plan, reengage-tick
    outreach/            template, warm-up, rate-limit, cadência, enrich-email
    crypto/              criptografia das credenciais
scrapling/               microserviço Python FastAPI
  app/
    main.py, config, auth, schemas, errors
    routers/             health, linkedin, google_maps, instagram
    scrapers/            linkedin_search, google_maps_search, instagram_search
agente/                  microserviço do agente SDR conversacional
docker/                  scripts de init do Postgres
drizzle/                 migrations
docs/                    documentação por tema
docker-compose.yml       stack completa (postgres + app + worker + scrapling)
docker-compose.dev.yml   Postgres + Scrapling (dev)
docker-compose.prod.yml  produção
```

## Scripts

- `pnpm dev` roda o Next em desenvolvimento
- `pnpm build` build de produção
- `pnpm typecheck` checagem TypeScript
- `pnpm lint` ESLint
- `pnpm worker` processa as filas
- `pnpm db:generate` gera migration
- `pnpm db:migrate` aplica migrations (produção)
- `pnpm db:studio` abre o Drizzle Studio

## Documentação por tema

- [Variáveis de ambiente](docs/env-vars.md)
- [Microserviço Scrapling](docs/scrapling.md) (e o [README do serviço](scrapling/README.md))
- [Pipeline, temperatura e atividades](docs/pipeline.md)
- [CSV e webhook de formulários](docs/csv-webhook.md)
- [Agente inbound](docs/agent.md)
- [Webhooks de WhatsApp](docs/whatsapp.md)

## Variáveis de ambiente

Todas as credenciais entram por ambiente. Copie `.env.example` e preencha. As principais:

- `DATABASE_URL`: conexão do PostgreSQL
- `ANTHROPIC_API_KEY`: chave da Anthropic (qualificação e bot). Obrigatória
- `CREDENTIALS_ENCRYPTION_KEY`: chave AES para as credenciais por organização. Idêntica em todos os ambientes
- `SCRAPLING_URL` e `SCRAPLING_SHARED_SECRET`: endereço e segredo do serviço de scraping
- Segredos de verificação e assinatura dos webhooks de cada canal
- `CRON_SECRET`: protege a rota de cron

Nunca comite um `.env` de verdade. Só o `.env.example` fica no repositório.

## Uso responsável

Use dentro das leis de proteção de dados e dos termos de cada plataforma. Prospecção ativa exige respeitar limites de envio, opt-out e as regras de cada canal.
