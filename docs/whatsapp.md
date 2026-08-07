# WhatsApp - 3 providers

O projeto suporta 3 formas de integrar WhatsApp, usadas em ordem de prioridade:

1. **Meta Cloud API** (oficial) - `whatsapp_api`
2. **UazAPI** (self-hosted ou cloud, REST API) - `whatsapp_uazapi`
3. **Baileys QR** (conecta via QR code, WhatsApp Web) - `whatsapp_qr`

Todos podem conviver na mesma org. O sistema escolhe o primeiro disponivel.

## Outbound (enviar mensagem)

Handler: `src/lib/queue/handlers/outreach-send.ts` (canal `whatsapp`).

Ordem:
1. Se existe credential `whatsapp_api`, usa Meta Cloud API
2. Senao, se existe `whatsapp_uazapi`, usa UazAPI
3. Senao, se existe `whatsapp_qr`, usa Baileys

## Inbound (receber mensagem)

Webhook: `POST /api/webhooks/whatsapp`.

Formatos suportados no mesmo endpoint:

### Meta Cloud API
```json
{
  "entry": [{
    "changes": [{
      "value": {
        "phone_number_id": "123...",
        "messages": [{
          "id": "wamid...",
          "from": "5511999999999",
          "type": "text",
          "text": { "body": "oi" }
        }]
      }
    }]
  }]
}
```

O handler busca a credential `whatsapp_api` cujo `phone_number_id` bate e usa a organizacao dela.

### UazAPI
```json
{
  "event": "message",
  "data": {
    "from": "5511999999999",
    "body": "oi",
    "id": "...",
    "type": "text"
  }
}
```

Como UazAPI nao passa identificador da instancia no webhook, o handler tenta todas as credentials `whatsapp_uazapi` sequencialmente (TODO: melhorar para usar `instance` do payload).

### Verificacao Meta (GET)

Meta chama `GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`.

Requer `WHATSAPP_VERIFY_TOKEN` no env. Configure esse mesmo valor no dashboard do Meta.

## Credentials

Cadastradas em `/settings/credentials` como JSON.

### `whatsapp_api` (Meta Cloud)
```json
{
  "phone_number_id": "123...",
  "access_token": "EAA...",
  "waba_id": "...",
  "verify_token": "..."
}
```

### `whatsapp_uazapi`
```json
{
  "base_url": "https://sua-uazapi.com",
  "token": "...",
  "instance": "...",
  "webhook_token": "..."
}
```

### `whatsapp_qr` (Baileys)

Configurada via `/settings/credentials/whatsapp` (scan do QR code). Sessao salva criptografada em `credentials.ciphertext`.

## Inbound agent

Quando `agent_configs.enabled = true`, cada mensagem inbound enfileira `agent.reply` que responde automaticamente. Detalhes em [docs/agent.md](agent.md).

## Webhooks no lado do provider

### Meta Cloud API
1. Dashboard do Meta -> WhatsApp -> Configuration
2. Webhook URL: `https://seu-dominio.com/api/webhooks/whatsapp`
3. Verify token: valor de `WHATSAPP_VERIFY_TOKEN`
4. Subscribe to: `messages`

### UazAPI
1. Painel UazAPI -> Instance -> Webhook
2. URL: `https://seu-dominio.com/api/webhooks/whatsapp`
3. Events: `message` (ou `message.received`)

### Baileys
Nao precisa webhook externo, a biblioteca recebe eventos direto via socket WhatsApp Web.

## Erros conhecidos

- **`WhatsAppAPIError` statusCode 400-499**: mensagem marcada como failed, thread como failed
- **`UazAPIPhoneNotFoundError`**: numero nao existe no WhatsApp
- **`WhatsAppNotConnectedError`**: Baileys desconectado, retry apos 1h
- **`WhatsAppAPINotConfiguredError` / `UazAPINotConfiguredError`**: credential nao cadastrada

## Rate limit

Por org + campanha + canal (`whatsapp`). Configurado em `dailyLimit` da campanha. Logica em `src/lib/outreach/rate-limit.ts`.
