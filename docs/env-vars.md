# Variaveis de ambiente

Arquivo `.env` na raiz do projeto. `.env.local` tem prioridade e fica fora do git.

Gere secrets com:
```bash
openssl rand -hex 32
```

## Core (obrigatorio)

| Variavel | Descricao | Exemplo |
|----------|-----------|---------|
| `DATABASE_URL` | Conexao Postgres | `postgresql://REMOVIDO_POR_SEGURANCA:REMOVIDO_POR_SEGURANCA@host/minerador` |
| `BETTER_AUTH_SECRET` | Secret do Better Auth (32+ chars) | `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | URL base do app | `http://localhost:3000` |
| `APP_URL` | URL publica | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_URL` | URL publica para client | `http://localhost:3000` |
| `NODE_ENV` | `development` ou `production` | |
| `CREDENTIALS_ENCRYPTION_KEY` | Chave pgcrypto para credentials | `openssl rand -hex 32` |
| `PGBOSS_SCHEMA` | Schema do pg-boss | `pgboss` |

## Postgres (docker-compose)

| Variavel | Default |
|----------|---------|
| `POSTGRES_USER` | `minerador` |
| `POSTGRES_PASSWORD` | `minerador` |
| `POSTGRES_DB` | `minerador` |

## Anthropic

| Variavel | Uso |
|----------|-----|
| `ANTHROPIC_API_KEY` | Fallback global. Preferido: cadastrar por organizacao em `/settings/credentials`. |

## Scrapling

Microservico Python que faz scraping stealth. **Unica via para LinkedIn, Google Maps e Instagram.** Sem fallback.

| Variavel | Default | Descricao |
|----------|---------|-----------|
| `SCRAPLING_URL` | `http://scrapling:8000` | URL interna do container |
| `SCRAPLING_SHARED_SECRET` | - | Obrigatorio. `openssl rand -hex 32` |
| `SCRAPLING_LOG_LEVEL` | `info` | `debug`, `info`, `warning`, `error` |
| `SCRAPLING_MAX_CONCURRENCY` | `2` | Requests concorrentes |
| `SCRAPLING_IG_SESSION_COOKIE` | - | Opcional. Cookie `sessionid` de conta burner do Instagram |

## Gmail (outreach outbound email)

| Variavel | Descricao |
|----------|-----------|
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth app no Google Cloud |
| `GOOGLE_OAUTH_CLIENT_SECRET` | |
| `GOOGLE_OAUTH_REDIRECT_URI` | `http://localhost:3000/api/auth/callback/google` |

## Webhook de formularios

Endpoint: `POST /api/webhooks/forms?org=<slug>&campaign=<uuid>&secret=<valor>`

| Variavel | Obrigatorio | Descricao |
|----------|-------------|-----------|
| `FORMS_WEBHOOK_SECRET` | sim | `openssl rand -hex 32`. Sem ele o endpoint retorna 503. |

## WhatsApp

| Variavel | Descricao |
|----------|-----------|
| `WHATSAPP_VERIFY_TOKEN` | Token que voce escolhe e configura no Meta dev dashboard para verificar webhook |

Credentials por organizacao em `/settings/credentials` e `/settings/credentials/whatsapp`:
- `whatsapp_api` (Meta Cloud API oficial)
- `whatsapp_uazapi` (self-hosted ou cloud)
- `whatsapp_qr` (Baileys direto)
