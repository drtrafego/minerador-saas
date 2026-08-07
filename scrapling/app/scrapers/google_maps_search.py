from __future__ import annotations

import asyncio
import re
from urllib.parse import quote_plus

from ..errors import BlockedError, UpstreamError
from ..schemas import PlaceLead

PHONE_RE = re.compile(r"(\+?\d[\d\s().-]{7,}\d)")
URL_RE = re.compile(r"https?://[^\s\"'<>]+")

# Regex para extrair emails de paginas de sites
_SITE_MAILTO_RE = re.compile(
    r'mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})',
    re.IGNORECASE,
)
_SITE_EMAIL_RE = re.compile(
    r'\b([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})\b',
)
# Prefixos descartados para evitar falsos positivos
_EMAIL_SKIP_PREFIXES = {
    "example", "test", "noreply", "no-reply", "donotreply",
    "sentry", "support@sentry", "notifications", "mailer-daemon",
}

_MAPS_BASE = "https://www.google.com"


async def _scroll_feed(page) -> None:
    try:
        for _ in range(10):
            await page.evaluate(
                "() => { const f = document.querySelector('div[role=feed]'); if (f) f.scrollBy(0, f.clientHeight); }"
            )
            await asyncio.sleep(1.2)
    except Exception:
        pass


async def search(
    query: str,
    location: str | None,
    max_results: int,
    fetch_website_email: bool = False,
) -> list[PlaceLead]:
    full_query = f"{query} em {location}" if location else query
    url = f"https://www.google.com/maps/search/{quote_plus(full_query)}"

    try:
        from scrapling.fetchers import AsyncDynamicSession
    except ImportError as exc:
        raise UpstreamError("scrapling AsyncDynamicSession indisponivel", code="deps") from exc

    try:
        async with AsyncDynamicSession(headless=True) as session:
            page = await session.fetch(
                url,
                network_idle=True,
                timeout=60000,
                page_action=_scroll_feed,
            )
    except Exception as exc:
        raise UpstreamError(f"falha ao abrir google maps: {exc}") from exc

    status = getattr(page, "status", None)
    if status and status >= 400:
        if status in (429, 503):
            raise BlockedError("google maps rate limit")
        raise UpstreamError(f"google maps http {status}")

    leads = _parse_cards(page, max_results)

    # Enriquecimento principal: visita a pagina de detalhe de cada lugar para
    # extrair telefone, website e endereco (nao disponiveis nos cards do feed).
    if leads:
        leads = await _fetch_place_details(leads)

    # Enriquecimento opcional: visita o site de cada lead para extrair email
    if fetch_website_email:
        leads = await _enrich_with_website_emails(leads)

    return leads[:max_results]


def _parse_cards(page, max_results: int) -> list[PlaceLead]:
    """
    Extrai nome, href e rating dos cards do feed lateral do Google Maps.
    Telefone, website e endereco NAO estao disponiveis no feed —
    sao extraidos posteriormente por _fetch_place_details().
    """
    leads: list[PlaceLead] = []
    try:
        cards = page.css("div[role='feed'] > div > div[jsaction]")
    except Exception:
        return leads

    seen: set[str] = set()
    for card in cards:
        try:
            name = card.css("div.fontHeadlineSmall::text, div[role='heading']::text").get()
            if not name:
                continue
            name = name.strip()
            info = " ".join(card.css("div.fontBodyMedium *::text").getall()) or ""
            href = card.css("a[href*='/maps/place/']::attr(href)").get() or ""
            place_id_match = re.search(r"!19s([^!]+)", href) or re.search(r"!1s([^!]+)", href)
            place_id = place_id_match.group(1) if place_id_match else href.split("?")[0]
            if not place_id or place_id in seen:
                continue
            seen.add(place_id)

            rating_match = re.search(r"(\d+[.,]\d+)\s*\(", info) or re.search(r"(\d+[.,]\d+)", info)
            ratings_total_match = re.search(r"\((\d[\d\.]*)\)", info)

            rating = None
            if rating_match:
                try:
                    rating = float(rating_match.group(1).replace(",", "."))
                except Exception:
                    rating = None
            user_ratings_total = None
            if ratings_total_match:
                try:
                    user_ratings_total = int(ratings_total_match.group(1).replace(".", "").replace(",", ""))
                except Exception:
                    user_ratings_total = None

            leads.append(
                PlaceLead(
                    place_id=place_id,
                    name=name,
                    phone=None,
                    email=None,
                    website=None,
                    address=None,
                    city=None,
                    state=None,
                    country=None,
                    rating=rating,
                    user_ratings_total=user_ratings_total,
                    types=[],
                    location=None,
                    raw={"href": href, "info": info[:400]},
                )
            )
            if len(leads) >= max_results:
                break
        except Exception:
            continue
    return leads


_N_BROWSERS = 3


async def _fetch_place_details(leads: list[PlaceLead]) -> list[PlaceLead]:
    """
    Para cada lead, abre a pagina de detalhe do Google Maps (URL individual
    do lugar) e extrai telefone, website e endereco do HTML renderizado.

    Reusa navegador: em vez de abrir um AsyncDynamicSession NOVO por lead
    (o que para 100+ leads chegava a abrir/fechar 100+ Chromiums e travava
    com TargetClosedError), divide os leads em _N_BROWSERS grupos round-robin
    e abre UM navegador por grupo, processando os leads do grupo em SEQUENCIA
    dentro dele. Os grupos rodam em paralelo entre si.

    Seletores CSS primarios (data-item-id e estaveis no Maps):
      - telefone : [data-item-id^='phone:tel']
      - website  : [data-item-id='authority']
      - endereco : [data-item-id='address']
    Regex nos fallbacks caso os seletores nao retornem nada.
    """
    try:
        from scrapling.fetchers import AsyncDynamicSession
    except ImportError:
        return leads

    async def _extract_details(lead: PlaceLead, detail_page) -> None:
        raw = getattr(detail_page, "body", None) or str(detail_page)
        html = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)

        # --- Telefone ---
        # Seletor: data-item-id comecando com "phone:tel" ou "phone"
        phone_texts = (
            detail_page.css("[data-item-id^='phone:tel'] *::text").getall()
            or detail_page.css("[data-item-id^='phone:tel']::text").getall()
            or detail_page.css("[data-item-id^='phone'] *::text").getall()
            or detail_page.css("[data-item-id^='phone']::text").getall()
        )
        if phone_texts:
            combined = " ".join(phone_texts)
            m = PHONE_RE.search(combined)
            if m:
                lead.phone = m.group(1).strip()
        # Fallback: regex no HTML completo (telefone aparece em texto visivel)
        if not lead.phone:
            m = PHONE_RE.search(html)
            if m:
                lead.phone = m.group(1).strip()

        # --- Website ---
        # Seletor: link com data-item-id="authority" (padrao do Maps para site oficial)
        website_href = (
            detail_page.css("[data-item-id='authority']::attr(href)").get()
            or detail_page.css("a[data-item-id='authority']::attr(href)").get()
        )
        if website_href:
            lead.website = website_href
        # Fallback: regex no HTML
        if not lead.website:
            m = (
                re.search(r'data-item-id="authority"[^>]*href="([^"]+)"', html)
                or re.search(r'href="([^"]+)"[^>]*data-item-id="authority"', html)
            )
            if m:
                lead.website = m.group(1)

        # --- Endereco ---
        addr_el = (
            detail_page.css("[data-item-id='address'] span::text").get()
            or detail_page.css("[data-item-id='address']::text").get()
        )
        if addr_el:
            lead.address = addr_el.strip()
            if not lead.city:
                lead.city = _extract_city_from_address(lead.address)

    async def _process_group(group: list[PlaceLead]) -> None:
        if not group:
            return
        try:
            async with AsyncDynamicSession(headless=True) as session:
                for lead in group:
                    href = lead.raw.get("href", "")
                    if not href:
                        continue
                    if href.startswith("/"):
                        href = _MAPS_BASE + href
                    if not href.startswith("http"):
                        continue

                    try:
                        # Espera o painel do lugar carregar (h1 = nome) em vez de
                        # network_idle: o Google Maps nunca fica com a rede idle (tiles
                        # do mapa recarregam), entao network_idle batia o timeout de 15s
                        # em CADA lugar. Esperar o h1 corta o tempo por lugar de ~15s
                        # para ~2-4s. Telefone/site/endereco ja vem no mesmo render.
                        detail_page = await session.fetch(href, wait_selector="h1", timeout=12000)
                        await _extract_details(lead, detail_page)
                    except Exception:
                        # Lead individual falhou: segue pro proximo sem derrubar
                        # o navegador do grupo.
                        continue

                    await asyncio.sleep(0.2)
        except Exception:
            # Navegador do grupo inteiro falhou: os leads deste grupo ficam
            # sem enriquecimento, mas a funcao nao pode travar os outros grupos.
            pass

    groups = [leads[i::_N_BROWSERS] for i in range(_N_BROWSERS)]
    await asyncio.gather(
        *[_process_group(group) for group in groups],
        return_exceptions=True,
    )
    return leads


def _extract_city_from_address(address: str) -> str | None:
    """
    Tenta extrair a cidade de um endereco brasileiro.
    Formatos comuns:
      "Rua X, 123 - Bairro - Gramado - RS, 95670-000"
      "Rua X, 123, Gramado - RS"
    Estrategia: procura o token imediatamente antes de um estado (2 letras maiusculas).
    """
    parts = re.split(r"\s*[-,]\s*", address)
    for i, part in enumerate(parts):
        part_stripped = part.strip()
        # Identifica token de estado (2 letras maiusculas, ex: RS, SP, SC)
        if re.match(r"^[A-Z]{2}$", part_stripped) and i > 0:
            candidate = parts[i - 1].strip()
            # Descarta CEP, numeros puros e tokens muito curtos
            if (
                len(candidate) >= 3
                and not re.match(r"^\d", candidate)
                and not re.match(r"^\d{5}-?\d{3}$", candidate)
            ):
                return candidate
    return None


async def _enrich_with_website_emails(leads: list[PlaceLead]) -> list[PlaceLead]:
    """
    Para cada lead que tem website, tenta extrair email da pagina.
    Usa semaforo=5 para nao sobrecarregar o VPS.
    """
    sem = asyncio.Semaphore(5)

    async def bounded(lead: PlaceLead) -> PlaceLead:
        if not lead.website:
            return lead
        async with sem:
            email = await _extract_email_from_website(lead.website)
            if email:
                lead.email = email
            return lead

    enriched = await asyncio.gather(*[bounded(l) for l in leads], return_exceptions=True)
    return [
        r if isinstance(r, PlaceLead) else leads[i]
        for i, r in enumerate(enriched)
    ]


async def _extract_email_from_website(url: str) -> str | None:
    """
    Visita a URL do site e tenta extrair um email de contato valido.
    Prioriza links mailto:, depois texto livre.
    Retorna None em caso de falha ou nenhum email encontrado.
    """
    # Pula sites sociais / agregadores: nao tem email util e travam (linktr.ee,
    # instagram, etc nunca ficam "idle" e estouravam o timeout, prendendo a
    # mineracao inteira). So vale abrir site proprio do estabelecimento.
    low = url.lower()
    if any(
        s in low
        for s in (
            "instagram.com", "facebook.com", "fb.com", "linktr.ee", "linktree",
            "wa.me", "api.whatsapp", "tiktok.com", "youtube.com", "youtu.be",
            "twitter.com", "x.com", "ifood.", "goo.gl", "bit.ly", "linktr",
        )
    ):
        return None

    try:
        from scrapling.fetchers import AsyncStealthySession
    except ImportError:
        return None

    try:
        # Sem network_idle (nunca completa em site com trackers) e timeout curto:
        # se o site nao carregar rapido, desiste e segue, sem travar a mineracao.
        async with AsyncStealthySession(headless=True) as session:
            page = await session.fetch(url, timeout=5000)
    except Exception:
        return None

    if getattr(page, "status", 0) >= 400:
        return None

    raw = getattr(page, "body", None) or str(page)
    html = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else str(raw)

    # Prioridade 1: links mailto:
    for m in _SITE_MAILTO_RE.finditer(html):
        email = m.group(1).lower()
        if not _is_junk_email(email):
            return email

    # Prioridade 2: texto livre (email pattern)
    for m in _SITE_EMAIL_RE.finditer(html):
        email = m.group(1).lower()
        if not _is_junk_email(email):
            return email

    return None


def _is_junk_email(email: str) -> bool:
    local = email.split("@")[0].lower()
    for skip in _EMAIL_SKIP_PREFIXES:
        if local.startswith(skip):
            return True
    # Descarta emails sem TLD real (ex: "user@example")
    parts = email.split("@")
    if len(parts) != 2:
        return True
    domain = parts[1]
    if "." not in domain:
        return True
    return False
