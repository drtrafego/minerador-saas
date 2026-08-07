"""FastAPI app do agente SDR, webhook Meta WhatsApp Cloud API oficial."""
import logging

from fastapi import FastAPI, Request, Response

from brain import router as brain_router
from config import settings
from webhook.meta import handle_incoming, verify, verify_signature

logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger(__name__)

app = FastAPI(title="Agente SDR Minerador SaaS")

app.include_router(brain_router)


@app.get("/health")
async def health() -> dict:
    return {"ok": True}


async def _meta_verify(request: Request):
    return await verify(request)


async def _meta_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("x-hub-signature-256", "")
    if not verify_signature(body, sig):
        return Response(status_code=401, content="invalid signature")
    try:
        payload = await request.json()
    except Exception:
        return Response(status_code=400, content="invalid json")
    await handle_incoming(payload)
    return {"ok": True}


# Webhook em dois paths: /webhook/meta (padrao do projeto) e
# /api/whatsapp/webhook (path ja configurado no app da Meta do cliente).
for _path in ("/webhook/meta", "/api/whatsapp/webhook"):
    app.get(_path)(_meta_verify)
    app.post(_path)(_meta_webhook)
