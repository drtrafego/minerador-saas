from __future__ import annotations

import asyncio
import re
from urllib.parse import quote_plus

from ..errors import BlockedError, UpstreamError
from ..schemas import IgLead

IG_URL_RE = re.compile(r"instagram\.com/([A-Za-z0-9_.]{1,30})(?=[/?#\"'\s<>]|$)")
IG_SKIP = {"p", "explore", "accounts", "reel", "reels", "stories", "tv", "direct", "tags"}

# Padroes para extrair email e telefone do JSON embutido na pagina de perfil do Instagram
_IG_EMAIL_RE = re.compile(
    r'"(?:business_email|public_email)"\s*:\s*"([^"@\s]{1,64}@[^"]{1,100})"'
)
_IG_MAILTO_RE = re.compile(
    r'mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})'
)
_IG_PHONE_RE = re.compile(
    r'"(?:public_phone_number|contact_phone_number|whatsapp_number)"\s*:\s*"([^"]{5,30})"'
)


async def search(
    search_term: str,
    search_type: str,
    max_results: int,
    enrich_profiles: bool = True,
) -> list[IgLead]:
    try:
        from scrapling.fetchers import AsyncStealthySession
    except ImportError as exc:
        raise UpstreamError("scrapling AsyncStealthySession indisponivel", code="deps") from exc

    if search_type == "hashtag":
        # Busca perfis que mencionam a hashtag, nao a pagina explore/tags
        # (site:instagram.com/explore/tags retorna apenas a pagina da tag em si,
        # que e filtrada por IG_SKIP["explore"] e nao traz perfis uteis)
        tag = search_term.lstrip("#")
        dork = f'site:instagram.com "{tag}" -site:instagram.com/p/ -site:instagram.com/reel/'
    else:
        dork = f'site:instagram.com "{search_term}" -site:instagram.com/p/ -site:instagram.com/reel/'

    search_url = f"https://duckduckgo.com/?q={quote_plus(dork)}&kp=-1&kl=br-pt"

    try:
        async with AsyncStealthySession(headless=True) as session:
            page = await session.fetch(
                search_url,
                wait_selector="a",
                network_idle=True,
            )
    except Exception as exc:
        raise UpstreamError(f"instagram dork falhou: {exc}") from exc

    status = getattr(page, "status", None)
    if status in (429, 503):
        raise BlockedError("duckduckgo rate limit")
    if status and status >= 400:
        raise UpstreamError(f"duckduckgo http {status}")

    raw = getattr(page, "body", None) or str(page)
    html = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)
    usernames = _extract_usernames(html, max_results)

    # Enriquecimento: visita cada perfil para capturar email e telefone business
    if enrich_profiles and usernames:
        enrichments = await _enrich_all(usernames)
    else:
        enrichments = [(None, None)] * len(usernames)

    leads: list[IgLead] = []
    for username, (email, phone) in zip(usernames, enrichments):
        leads.append(IgLead(
            username=username,
            full_name=None,
            bio=None,
            followers=None,
            following=None,
            posts_count=None,
            category=None,
            external_url=None,
            is_business_account=None,
            profile_pic_url=None,
            email=email,
            phone=phone,
            raw={"source": "duckduckgo_dork"},
        ))

    return leads


def _extract_usernames(html: str, max_results: int) -> list[str]:
    seen: list[str] = []
    seen_set: set[str] = set()
    for m in IG_URL_RE.finditer(html):
        username = m.group(1).rstrip("/").lower()
        if username in IG_SKIP or username in seen_set:
            continue
        seen_set.add(username)
        seen.append(username)
        if len(seen) >= max_results:
            break
    return seen


async def _enrich_all(
    usernames: list[str],
) -> list[tuple[str | None, str | None]]:
    """Visita cada perfil do Instagram em paralelo (semaforo=5) e extrai email e phone."""
    sem = asyncio.Semaphore(5)

    async def bounded(username: str) -> tuple[str | None, str | None]:
        async with sem:
            return await _enrich_ig_profile(username)

    results = await asyncio.gather(
        *[bounded(u) for u in usernames],
        return_exceptions=True,
    )
    return [
        r if isinstance(r, tuple) else (None, None)
        for r in results
    ]


async def _enrich_ig_profile(username: str) -> tuple[str | None, str | None]:
    """
    Retorna (email, phone) extraidos do perfil publico do Instagram.
    Retorna (None, None) em caso de qualquer falha ou bloqueio.
    """
    try:
        from scrapling.fetchers import AsyncStealthySession
    except ImportError:
        return (None, None)

    try:
        async with AsyncStealthySession(headless=True) as session:
            page = await session.fetch(
                f"https://www.instagram.com/{username}/",
                network_idle=True,
                timeout=6000,
            )
    except Exception:
        return (None, None)

    if getattr(page, "status", 0) >= 400:
        return (None, None)

    raw = getattr(page, "body", None) or str(page)
    html = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)

    # Email: tenta extrair de campos JSON do perfil business
    email: str | None = None
    m = _IG_EMAIL_RE.search(html)
    if m:
        email = m.group(1)
    else:
        m = _IG_MAILTO_RE.search(html)
        if m:
            email = m.group(1)

    # Telefone: tenta extrair de campos JSON do perfil business
    phone: str | None = None
    m = _IG_PHONE_RE.search(html)
    if m:
        val = m.group(1).strip()
        if val:
            phone = val

    return (email, phone)
