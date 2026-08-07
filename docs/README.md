# Documentacao

Indice da documentacao tecnica do minerador_claude. O [README principal](../README.md) tem visao geral e setup.

## Guias por area

| Doc | Conteudo |
|-----|----------|
| [env-vars.md](env-vars.md) | Todas as variaveis de ambiente, como gerar secrets |
| [scrapling.md](scrapling.md) | Microservico Python de scraping stealth (LinkedIn, Maps, IG) |
| [pipeline.md](pipeline.md) | Kanban, lead temperature, activity timeline |
| [csv-webhook.md](csv-webhook.md) | Import/export CSV, webhook generico de formularios |
| [agent.md](agent.md) | Inbound agent WhatsApp com Claude (UazAPI + Meta) |
| [whatsapp.md](whatsapp.md) | 3 providers (Meta Cloud, UazAPI, Baileys QR) |
| [CHANGELOG.md](CHANGELOG.md) | Historico de mudancas |

## Arquitetura por camada

```
                            UI (Next.js App Router)
                                     |
                          Server Actions + API Routes
                                     |
                              Drizzle ORM
                                     |
                    +----------------+-----------------+
                    |                |                 |
              pg-boss queue    Postgres DB      Credentials (pgcrypto)
                    |                                  |
                    v                                  v
             Worker (Node)                  Organization scoping
                    |
       +------------+-------------+------+----------+------------+
       |            |             |      |          |            |
    scrape       ingest       qualify  outreach   agent       outreach
     (Maps       (insert      (Claude   enqueue   reply       send
     IG           leads)       tool     (schedule (inbound   (Email,
     LinkedIn)                  use)     steps)    WhatsApp)  IG, LI,
                                                              WA)
       |
       v
  Scrapling (Python, FastAPI)       Gmail API
  Apify (fallback)                  Playwright (IG DM, LinkedIn DM)
  Places API (fallback)             WhatsApp: Meta / UazAPI / Baileys
```

## Schemas principais

- `auth` (Better Auth): user, session, account, organization, member
- `credentials`: API keys criptografadas com pgcrypto
- `campaigns`, `campaign_sources`: configuracao de mineracao
- `leads`: dados minerados, qualificacao, temperature, pipeline_stage_id
- `pipeline_stages`: etapas customizaveis do funil
- `activities`: timeline de interacoes
- `outreach_threads`, `outreach_messages`, `outreach_queue`: conversas outbound/inbound
- `scraping_jobs`, `qualification_jobs`, `send_counters`: observabilidade + rate limit
- `agent_configs`: config do inbound agent WhatsApp
- `browser_runs`: execucoes Playwright
- `webhooks_log`, `events`: audit trail
