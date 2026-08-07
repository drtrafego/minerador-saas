import asyncio
from typing import Awaitable, Callable, TypeVar

from ..errors import BlockedError, ScraperError, TimeoutError_

T = TypeVar("T")


async def with_timeout(coro: Awaitable[T], timeout_ms: int) -> T:
    try:
        return await asyncio.wait_for(coro, timeout=timeout_ms / 1000)
    except asyncio.TimeoutError as exc:
        raise TimeoutError_("scraper timeout") from exc


async def retry(fn: Callable[[], Awaitable[T]], attempts: int = 2, base_delay_s: float = 1.0) -> T:
    last: Exception | None = None
    for i in range(attempts + 1):
        try:
            return await fn()
        except (BlockedError, TimeoutError_):
            raise
        except ScraperError as exc:
            last = exc
        except Exception as exc:
            last = exc
        if i < attempts:
            await asyncio.sleep(base_delay_s * (3 ** i))
    assert last is not None
    raise last
