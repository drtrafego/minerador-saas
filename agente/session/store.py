"""Armazenamento de sessao do agente, Redis com fallback para CRM."""
import json
import logging
from typing import Any

import httpx
import redis.asyncio as aioredis

from config import settings

logger = logging.getLogger(__name__)


class Session:
    def __init__(self, lead_id: str, messages: list[dict] | None = None) -> None:
        self.lead_id = lead_id
        self.messages: list[dict] = messages or []

    def append(self, role: str, content: str) -> None:
        if not content:
            return
        self.messages.append({"role": role, "content": content})

    def append_assistant_tool_use(self, text: str, tool_calls: list[dict]) -> None:
        blocks: list[dict] = []
        if text:
            blocks.append({"type": "text", "text": text})
        for tc in tool_calls:
            blocks.append(
                {
                    "type": "tool_use",
                    "id": tc["id"],
                    "name": tc["name"],
                    "input": tc.get("args", {}),
                }
            )
        if blocks:
            self.messages.append({"role": "assistant", "content": blocks})

    def append_tool_results(self, results: list[dict]) -> None:
        if not results:
            return
        blocks = [
            {
                "type": "tool_result",
                "tool_use_id": r["tool_use_id"],
                "tool_name": r.get("tool_name", ""),
                "content": json.dumps(r["content"], ensure_ascii=False),
            }
            for r in results
        ]
        self.messages.append({"role": "user", "content": blocks})

    def to_dict(self) -> dict[str, Any]:
        return {"lead_id": self.lead_id, "messages": self.messages}


class _SessionStore:
    def __init__(self) -> None:
        self._redis: aioredis.Redis | None = None

    async def _client(self) -> aioredis.Redis | None:
        if self._redis is not None:
            return self._redis
        try:
            self._redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
            await self._redis.ping()
        except Exception as exc:
            logger.warning("Redis indisponivel, usando fallback CRM: %s", exc)
            self._redis = None
        return self._redis

    def _key(self, lead_id: str) -> str:
        return f"agente:session:{lead_id}"

    async def load(self, lead_id: str) -> Session:
        client = await self._client()
        if client is not None:
            try:
                raw = await client.get(self._key(lead_id))
                if raw:
                    data = json.loads(raw)
                    return Session(lead_id, data.get("messages", []))
            except Exception as exc:
                logger.warning("Falha ao ler sessao do Redis: %s", exc)

        try:
            async with httpx.AsyncClient(timeout=10.0) as http:
                resp = await http.get(
                    f"{settings.CRM_BASE_URL}/api/leads/{lead_id}/history",
                    headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
                )
                if resp.status_code == 200:
                    body = resp.json()
                    return Session(lead_id, body.get("messages", []))
        except Exception as exc:
            logger.warning("Fallback CRM history falhou: %s", exc)

        return Session(lead_id, [])

    async def save(self, lead_id: str, session: Session) -> None:
        client = await self._client()
        if client is not None:
            try:
                await client.set(
                    self._key(lead_id),
                    json.dumps(session.to_dict(), ensure_ascii=False),
                    ex=settings.SESSION_TTL_SECONDS,
                )
            except Exception as exc:
                logger.warning("Falha ao salvar sessao no Redis: %s", exc)

        try:
            async with httpx.AsyncClient(timeout=10.0) as http:
                await http.post(
                    f"{settings.CRM_BASE_URL}/api/leads/{lead_id}/history",
                    headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
                    json={"messages": session.messages},
                )
        except Exception as exc:
            logger.warning("Persistencia CRM history falhou: %s", exc)


SessionStore = _SessionStore()
