# Scrapling - Microservico de scraping stealth

Microservico Python (FastAPI + [Scrapling](https://github.com/D4Vinci/Scrapling)) que expoe scraping para LinkedIn, Google Maps e Instagram com bypass de Cloudflare, TLS fingerprint e rotacao de user-agent. E o **default** para os 3 canais.

## Por que

- LinkedIn nao tem scraper oficial acessivel
- Apify cobra por lead (~$0,50 a $1 por perfil Instagram)
- Google Places API cobra por request (~$17/1000 searches)
- Scrapling roda gratis em qualquer VPS

## Arquitetura

```
Node worker (scrape.ts handler)
    |
    | POST /v1/linkedin/search  (X-Scrapling-Secret header)
    v
Container Python (FastAPI, porta 8000, so rede interna minerador_net)
    |
    v
Scrapling (StealthyFetcher / DynamicFetcher com Playwright)
```

Scrapling e o unico caminho para scraping dos 3 canais. Se ele falha, o job falha e pg-boss faz retry com backoff.

## Endpoints

Todas as rotas autenticadas exigem o header `X-Scrapling-Secret: <SCRAPLING_SHARED_SECRET>`.

### `GET /v1/health`
Sem auth. Retorna versao e uptime.

### `POST /v1/linkedin/search`
```json
{
  "query": "founder fintech brasil",
  "max_results": 50,
  "location": null,
  "timeout_ms": 120000
}
```
Estrategia: busca no Google com dork `site:linkedin.com/in "query"` e enriquece metadados via title tag da pagina publica.

### `POST /v1/google-maps/search`
```json
{
  "query": "dentista",
  "location": "Sao Paulo, SP",
  "max_results": 60,
  "timeout_ms": 150000
}
```
Estrategia: Playwright em `https://www.google.com/maps/search/...`, scroll no feed, parse dos cards.

### `POST /v1/instagram/search`
```json
{
  "search": "confeitaria sp",
  "search_type": "user",
  "max_results": 30,
  "timeout_ms": 150000
}
```
`search_type`: `user` ou `hashtag`. Usa endpoint publico `web/search/topsearch` + `web_profile_info`. Cookie opcional via `SCRAPLING_IG_SESSION_COOKIE`.

## Estrutura do servico

```
scrapling/
  app/
    main.py             FastAPI app + exception handlers
    config.py           pydantic-settings (env SCRAPLING_*)
    auth.py             middleware X-Scrapling-Secret (secrets.compare_digest)
    schemas.py          pydantic request/response
    errors.py           ScraperError, TimeoutError_, BlockedError, UpstreamError
    routers/
      health.py
      linkedin.py
      google_maps.py
      instagram.py
    scrapers/
      base.py           with_timeout, retry helpers
      linkedin_search.py
      google_maps_search.py
      instagram_search.py
  Dockerfile            baseado em mcr.microsoft.com/playwright/python
  requirements.txt
  .dockerignore
  README.md
```

## Cliente TypeScript

`src/lib/clients/scrapling.ts` expoe:

```ts
searchLinkedInViaScrapling({ query, maxResults, location, timeoutMs })
searchGoogleMapsViaScrapling({ query, location, maxResults, timeoutMs })
searchInstagramViaScrapling({ search, searchType, maxResults, timeoutMs })
pingScrapling()   // health check
```

Retry: 3 tentativas com backoff linear em network/5xx. Erros `auth`/`blocked` nao fazem retry. Timeout default 150s.

## Integracao no handler

`src/lib/queue/handlers/scrape.ts` roteia por `source.type`:

| source.type | Scraper |
|-------------|---------|
| `google_places` | Scrapling (Google Maps) |
| `instagram_hashtag` / `instagram_profile` | Scrapling |
| `linkedin_search` | Scrapling |

## Operacao

Subir so o Scrapling:
```bash
docker compose up -d scrapling
```

Ver logs:
```bash
docker compose logs -f scrapling
```

Testar health dentro do container:
```bash
docker compose exec scrapling curl -s http://127.0.0.1:8000/v1/health
```

Testar LinkedIn (de dentro do worker por exemplo):
```bash
curl -X POST http://scrapling:8000/v1/linkedin/search \
  -H "Content-Type: application/json" \
  -H "X-Scrapling-Secret: $SCRAPLING_SHARED_SECRET" \
  -d '{"query":"founder saas brasil","max_results":10,"timeout_ms":60000}'
```

## Ajustes por canal

- **LinkedIn**: ajustar regex em `app/scrapers/linkedin_search.py` se Google mudar layout
- **Google Maps**: ajustar seletores CSS em `_parse_cards` se Google Maps mudar
- **Instagram**: setar `SCRAPLING_IG_SESSION_COOKIE` (sessionid de burner) para evitar rate limit

## Seguranca

- Secret timing-safe via `secrets.compare_digest`
- Container **nao expoe porta 8000 para o host** (so rede interna)
- Sem cookies persistidos por default (use `SCRAPLING_IG_SESSION_COOKIE` com burner)
- Rate limit detectado retorna 429 com `code: blocked`
