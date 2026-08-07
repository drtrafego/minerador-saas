"""Debouncer de mensagens, agrupando em janelas curtas antes de processar."""
import asyncio
import logging
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)


class Debouncer:
    def __init__(self, seconds: int = 5) -> None:
        self.seconds = seconds
        self._buffers: dict[str, list[str]] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock(self, key: str) -> asyncio.Lock:
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]

    async def add(
        self,
        key: str,
        text: str,
        callback: Callable[[list[str]], Awaitable[None]],
    ) -> None:
        async with self._lock(key):
            self._buffers.setdefault(key, []).append(text)
            old = self._tasks.get(key)
            if old and not old.done():
                old.cancel()
            self._tasks[key] = asyncio.create_task(self._wait(key, callback))

    async def _wait(
        self,
        key: str,
        callback: Callable[[list[str]], Awaitable[None]],
    ) -> None:
        try:
            await asyncio.sleep(self.seconds)
        except asyncio.CancelledError:
            return

        async with self._lock(key):
            batch = self._buffers.pop(key, [])
            self._tasks.pop(key, None)
            if key not in self._tasks and key not in self._buffers:
                self._locks.pop(key, None)

        if not batch:
            return

        try:
            await callback(batch)
        except Exception as exc:
            logger.error("debouncer callback erro key=%s: %s", key, exc, exc_info=True)
