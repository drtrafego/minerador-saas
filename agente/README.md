## Agente SDR Minerador SaaS

Agente de prospeccao fria via WhatsApp, estilo ADK do Google. Conversa
humana, qualifica BANT em ate 5 perguntas, agenda call de 20 minutos.

### Estrutura

```
agente/
  agent.py          # define o agente
  runner.py         # loop tool calling
  main.py           # FastAPI webhook
  prompts/sdr.md    # system prompt
  tools/            # qualify_lead, schedule_call, update_crm_stage, search_knowledge, notify_human
  providers/        # anthropic, gemini factory
  session/          # store Redis + CRM, debouncer
  config.py         # pydantic-settings
```

### Rodar local

```bash
python -m venv .venv
. .venv/Scripts/activate     # Windows
. .venv/bin/activate         # Linux/Mac

pip install -r requirements.txt
cp .env.example .env         # ajuste as variaveis

uvicorn main:app --reload --port 8000
```

Health check:

```bash
curl http://localhost:8000/health
```

### Deploy Railway

```bash
railway init
railway up
```

Aponte o webhook UZApi para `https://<seu-app>.up.railway.app/webhook/uzapi`.

### Contrato com o CRM

O CRM expoe os endpoints abaixo, todos com `Authorization: Bearer ${CRM_API_TOKEN}`:

- `GET  /api/leads/{leadId}/history`
- `POST /api/leads/{leadId}/history`
- `PUT  /api/leads/{leadId}/stage`
- `POST /api/leads/{leadId}/qualify`
- `POST /api/leads/{leadId}/book-call`
- `POST /api/notify`
- `POST /api/whatsapp/bot-send`

### TODO

- `search_knowledge` esta como stub, aguardando documentacao RAG do Gastao
- Cliente UZApi de envio fica no CRM, o agente apenas chama `bot-send`
- Provider Gemini esta esqueleto, ative quando precisar
