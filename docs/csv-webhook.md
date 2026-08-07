# CSV import/export e webhook de formularios

Duas formas de trazer leads manualmente (alem do scraping) e uma de exportar.

## Import CSV

### UI: `/leads/import`

Fluxo:
1. **CSV**: paste no textarea ou upload de arquivo `.csv`
2. **Mapeamento**: seletor por campo (auto-detectado por nome de coluna)
3. **Preview**: primeiras 5 linhas renderizadas com o mapeamento atual
4. **Campanha**: opcional
5. **Importar**: dispara `importLeadsFromCsv` server action

### Parser

`src/lib/csv.ts` implementa parser RFC 4180-ish:
- Suporta aspas, escape de `""`, BOM, CRLF/LF
- `parseCsv(text) -> { headers: string[], rows: CsvRow[] }`
- `toCsv(headers, rows) -> string`

Sem dependencia externa.

### Auto-mapping

Hints em `src/app/(app)/leads/import/wizard.tsx`:

| Campo | Aliases reconhecidos |
|-------|----------------------|
| `displayName` | `name`, `nome`, `full_name`, `fullname`, `display_name` |
| `email` | `email`, `e-mail` |
| `phone` | `phone`, `telefone`, `whatsapp`, `celular` |
| `handle` | `handle`, `username`, `user`, `usuario` |
| `website` | `website`, `site`, `url` |
| `city` | `city`, `cidade` |
| `region` | `region`, `state`, `estado`, `uf` |
| `country` | `country`, `pais` |
| `company` | `company`, `empresa`, `companhia` |
| `headline` | `headline`, `cargo`, `title`, `titulo` |
| `linkedinUrl` | `linkedin`, `linkedin_url`, `linkedinurl` |

### Server action

```ts
importLeadsFromCsv({ campaignId?, rows: [...] })
```
Validado por zod. `externalId` gerado como `import-${timestamp}-${idx}`. Deduplicacao via `ON CONFLICT DO NOTHING` na chave `(org, source, external_id)`.

Retorna `{ ok, inserted, total }`.

## Export CSV

### Endpoint: `GET /api/leads/export`

Query params (opcionais):
- `status`: `all`, `pending`, `qualified`, `disqualified`, `needs_review`
- `campaign`: uuid da campanha

Retorna `text/csv` com `Content-Disposition: attachment; filename="leads-YYYY-MM-DD.csv"`.

Colunas exportadas:
`id, displayName, handle, email, phone, website, city, region, country, company, headline, linkedinUrl, source, qualificationStatus, qualificationScore, temperature, campaignName, createdAt`

Limite: 10.000 linhas por request.

### Botoes

Em `/leads`: "Importar CSV" -> `/leads/import`, "Exportar CSV" -> `/api/leads/export` com os filtros atuais da pagina.

## Webhook de formularios

### Endpoint

```
POST /api/webhooks/forms?org=<slug-ou-id>&campaign=<uuid>&secret=<valor>
```

Alternativa: header `X-Forms-Secret` em vez de `?secret=`.

`FORMS_WEBHOOK_SECRET` e **obrigatorio**. Sem ele configurado, endpoint retorna 503.

### Resolucao da organizacao

1. Tenta `organization.slug = <token>`
2. Fallback: `organization.id = <token>`

Se nenhum bater, retorna 404.

### Normalizacao do payload

O handler:
1. Loga em `webhooks_log` (provider=`forms`, event=`lead.submit`, payload original)
2. Desce em chaves comuns: `data`, `form_response`, `answers`, `fields`, `form`, `payload`
3. Flatten recursivo: transforma objetos aninhados em mapa `chave_normalizada -> valor`
4. Para arrays de `{ label, value }` (Typeform, Tally), extrai label como chave

### Field matching

Mesma tabela bilingue do CSV import. Tolerancia:
- Exact match primeiro (`nome` == `nome`)
- Depois includes (`nome_completo` inclui `nome`)

Se nao encontrar `displayName`, retorna 422.

### Resposta

```json
{ "ok": true, "leadId": "uuid-ou-null", "campaignId": "uuid-ou-null" }
```

Lead inserido com `source="manual"`, `qualificationStatus="pending"`. Campanha opcional (se token `?campaign=` bate com uma campanha da org).

### Auditoria

- `webhooks_log`: payload original
- `events`: `type=lead.form.received`, `entityType=lead`, `entityId=<lead.id>`, `data.flat = payload normalizado`

### Exemplos

#### Typeform webhook
No Typeform -> Connect -> Webhooks, cole:
```
https://seu-dominio.com/api/webhooks/forms?org=sua-org&secret=SEU_SECRET
```

#### Tally
Mesmo formato. O handler entende o shape `{ data: { fields: [{ label, value }] } }`.

#### Google Forms via Apps Script
```js
function onFormSubmit(e) {
  const payload = {
    answers: e.namedValues
  };
  UrlFetchApp.fetch("https://seu-dominio.com/api/webhooks/forms?org=sua-org&secret=SEU_SECRET", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
  });
}
```

#### Zapier
Webhooks by Zapier -> POST. URL com query string do secret. Body JSON livre (qualquer shape, o flatten resolve).

## Seguranca

- Secret obrigatorio: endpoint retorna 401 se incorreto, 503 se nao configurado no servidor
- Payload bruto salvo em `webhooks_log` para auditoria
- Deduplicacao por unique constraint evita sobrescrita acidental
