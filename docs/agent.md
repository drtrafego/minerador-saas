# Inbound agent WhatsApp

Agente conversacional que responde mensagens inbound no WhatsApp usando Claude. Suporta **UazAPI** e **Meta Cloud API oficial** (ambos selecionaveis por organizacao).

## Visao geral

```
Lead envia mensagem WhatsApp
    |
    v
Webhook /api/webhooks/whatsapp recebe (Meta ou UazAPI)
    |
    | 1. Insere outreach_message (inbound)
    | 2. Atualiza thread para "replied"
    | 3. Checa agent_configs.enabled
    | 4. Se on, enfileira agent.reply na pg-boss
    v
Worker processa agent.reply
    |
    | 1. Valida enabled, max replies, handoff keywords
    | 2. Busca historico (ultimas 20 mensagens)
    | 3. Monta system prompt com business_info + tone + rules
    | 4. Chama Claude
    | 5. Insere outbound message
    | 6. Envia via UazAPI ou Meta (conforme preferredProvider)
    v
Lead recebe resposta
```

## Tabela

### `agent_configs`

Uma linha por organizacao.

| Coluna | Tipo | Default | Descricao |
|--------|------|---------|-----------|
| `id` | uuid | | |
| `organization_id` | text (FK) | | Unique |
| `enabled` | boolean | `false` | Agente ativo? |
| `business_name` | text | null | Nome do negocio |
| `business_info` | text | null | Contexto livre (o que fazem, pra quem, diferenciais) |
| `tone` | text | `profissional e direto` | Tom de voz |
| `system_prompt_override` | text | null | Se >40 chars, substitui o prompt gerado |
| `rules` | jsonb | `[]` | Array de regras adicionais |
| `handoff_keywords` | jsonb | `["humano","atendente","pessoa real","parar","stop"]` | Palavras que param o agente |
| `preferred_provider` | text | `auto` | `auto` / `meta` / `uazapi` |
| `max_auto_replies` | int | `6` | Limite de respostas automaticas por thread |
| `model` | text | `claude-sonnet-4-5` | |
| `temperature` | int | `70` | Escala 0-100 (convertida para 0.0-1.0) |

## UI: `/settings/agent`

Form completo com toggle de `enabled`, textarea pro contexto, chips editaveis para regras e handoff keywords, select de provider, sliders de max replies e temperatura.

Se `system_prompt_override` for preenchido com mais de 40 chars, o prompt gerado automaticamente e ignorado.

## Server action

```ts
saveAgentConfig({
  enabled, businessName, businessInfo, tone,
  systemPromptOverride, rules, handoffKeywords,
  preferredProvider, maxAutoReplies, model, temperature,
})
```

Upsert por `organization_id`.

## System prompt gerado

Quando nao ha override, o prompt e montado em `buildSystemPrompt()`:

```
Voce e um agente de vendas conversacional que responde leads via WhatsApp
em nome de {business_name}.

Tom de voz: {tone}.

Contexto do negocio:
{business_info}

Campanha atual: {campaign.name} - {campaign.niche}.

Lead: {lead.displayName} ({lead.company}) em {lead.city}.

Regras inegociaveis:
- Responda APENAS com base no contexto acima. Nunca invente precos,
  prazos, produtos ou informacoes nao listadas.
- Mensagens curtas, maximo 3 paragrafos.
- Se o lead perguntar algo que voce nao sabe, peca pra aguardar humano.
- Nao use travessoes, hifens como separador, nem meia-risca.
- Responda sempre em portugues.
- O objetivo e qualificar interesse e agendar uma conversa rapida.
  Nao force venda.

Regras adicionais do cliente:
- {regra 1}
- {regra 2}
...
```

## Handler: `agent-reply.ts`

Fluxo:

1. Carrega `agent_configs` da org. Se nao existir ou `enabled=false`, retorna.
2. Carrega thread. Se canal != `whatsapp`, retorna (outros canais nao suportados ainda).
3. Conta mensagens outbound com `metadata.agent = true` no thread. Se >= `max_auto_replies`, marca thread como `awaiting_reply` e retorna.
4. Carrega a mensagem inbound. Checa se contem handoff keyword. Se sim, marca thread como `replied`, registra evento `agent.handoff` e retorna.
5. Carrega lead + campaign. Busca historico (ultimas 20 mensagens).
6. Converte historico para formato Claude: `inbound -> user`, `outbound -> assistant`.
7. Monta system prompt e chama `generateAgentReply` em `src/lib/clients/anthropic.ts`.
8. Insere mensagem outbound com `metadata.agent = true, model, costUsd, tokens`.
9. Envia via `sendWhatsApp(...)`:
   - `preferredProvider = auto` -> tenta Meta, depois UazAPI
   - `preferredProvider = meta` -> so Meta
   - `preferredProvider = uazapi` -> so UazAPI
10. Atualiza thread para `active`, registra evento `agent.reply.sent` com metrics.

## Integracao no webhook

`src/app/api/webhooks/whatsapp/route.ts`:
- Recebe mensagem inbound (Meta ou UazAPI), insere na tabela, atualiza thread
- Consulta `agent_configs.enabled` na org
- Se `true`, enfileira `agent.reply` com `{ organizationId, threadId, inboundMessageId }`

O envio da resposta acontece de forma assincrona pela fila, nao blocqueando o webhook (que sempre retorna 200 rapido para o Meta/UazAPI).

## Fila

Registrada no worker:

```ts
boss.work<AgentReplyPayload>(QUEUES.agentReply, { batchSize: 2 }, ...)
```

`batchSize: 2` para nao serializar respostas lentas.

## Custos

Cada resposta registra em `outreach_messages.metadata`:
```json
{
  "agent": true,
  "model": "claude-sonnet-4-5",
  "costUsd": 0.0034,
  "inputTokens": 850,
  "outputTokens": 160,
  "provider": "meta"
}
```

E em `events` tipo `agent.reply.sent`.

## Handoff para humano

Quando o agente detecta uma palavra de handoff no texto do lead, para de responder e marca a thread como `replied`. Um humano precisa assumir via `/inbox`.

Lista default: `humano`, `atendente`, `pessoa real`, `parar`, `stop`. Editavel em `/settings/agent`.

## Max auto replies

Protecao contra loop infinito. Conta somente mensagens `outbound` com `metadata.agent = true` (mensagens de follow up nao-agente nao contam). Default 6. Quando atinge, thread fica `awaiting_reply` e o agente nao responde mais automaticamente.

## Temperatura

Escala 0-100 na UI, dividida por 100 antes de passar para o Claude SDK (0.0-1.0). Valor default 70 (bom equilibrio entre coerencia e naturalidade).

## Models

Default `claude-sonnet-4-5`. Pode trocar por `claude-haiku-4-5` (mais rapido, mais barato) ou `claude-opus-4-5` (mais capaz). Editavel por org.
