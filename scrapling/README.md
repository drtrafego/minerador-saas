# Scrapling Service

Microservico Python (FastAPI + Scrapling) que expoe scraping stealth para o minerador. Rota protegida por shared secret.

Documentacao completa: [../docs/scrapling.md](../docs/scrapling.md).

## Endpoints

| Rota | Auth | Descricao |
|------|------|-----------|
| `GET /v1/health` | nao | Status e versao |
| `POST /v1/linkedin/search` | sim | Busca perfis LinkedIn via Google dork |
| `POST /v1/google-maps/search` | sim | Raspa resultados do Google Maps |
| `POST /v1/instagram/search` | sim | Busca perfis Instagram (user/hashtag) |

Requests autenticadas precisam do header `X-Scrapling-Secret: <valor de SCRAPLING_SHARED_SECRET>`.

## Rodando

Parte do `docker-compose.yml` do projeto. Gerar secret:

```bash
openssl rand -hex 32
```

Setar em `.env`:

```
SCRAPLING_SHARED_SECRET=<valor-gerado>
SCRAPLING_ENABLED=true
```

Subir:

```bash
docker compose up scrapling
```

Testar health:

```bash
docker compose exec scrapling curl -s http://127.0.0.1:8000/v1/health
```

## Dev local (sem docker)

```bash
cd scrapling
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m scrapling install
SCRAPLING_SHARED_SECRET=dev uvicorn app.main:app --reload
```

## Observacoes

- Instagram retorna melhor com `SCRAPLING_IG_SESSION_COOKIE` setado (sessionid de uma conta burner).
- Google Maps scraping depende do layout do Google; ajustar seletores em `app/scrapers/google_maps_search.py` se mudar.
- LinkedIn usa dork do Google, nao login. Resultado limitado aos metadados do titulo da pagina.
