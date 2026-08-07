import time

from fastapi import APIRouter

router = APIRouter()
_BOOT = time.time()


@router.get("/health")
async def health() -> dict:
    try:
        import scrapling  # type: ignore
        scrapling_version = getattr(scrapling, "__version__", "unknown")
    except Exception:
        scrapling_version = "unavailable"
    return {
        "ok": True,
        "version": "1.0.0",
        "scrapling_version": scrapling_version,
        "uptime_s": round(time.time() - _BOOT, 2),
    }


@router.get("/debug/imports")
async def debug_imports() -> dict:
    results = {}
    checks = [
        ("playwright", "import playwright"),
        ("patchright", "import patchright"),
        ("curl_cffi", "import curl_cffi"),
        ("browserforge", "import browserforge"),
        ("camoufox", "import camoufox"),
        ("AsyncDynamicSession", "from scrapling.fetchers import AsyncDynamicSession"),
        ("AsyncStealthySession", "from scrapling.fetchers import AsyncStealthySession"),
    ]
    for name, stmt in checks:
        try:
            exec(stmt)
            results[name] = "ok"
        except Exception as e:
            results[name] = str(e)
    return {"ok": True, "imports": results}
