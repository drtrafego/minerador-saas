"""Tool schedule_call: lista slots ou cria evento no Google Calendar."""
import asyncio
import logging
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from config import settings

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/calendar"]
TZ_SP = ZoneInfo("America/Sao_Paulo")
WEEKDAYS_PT = {0: "Segunda", 1: "Terça", 2: "Quarta", 3: "Quinta", 4: "Sexta", 5: "Sábado", 6: "Domingo"}
SLOT_HOURS = [9, 10, 11, 14, 15, 16, 17]

tool = {
    "name": "schedule_call",
    "description": (
        "Sem preferred_slot retorna 3 slots disponíveis nos próximos 5 dias úteis. "
        "Com preferred_slot e lead_email cria evento no Google Calendar e envia convite por email ao lead."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "preferred_slot": {
                "type": "string",
                "description": "ISO 8601 com tz -03:00, ex 2026-05-23T10:00:00-03:00",
            },
            "lead_email": {"type": "string", "description": "Email do lead para o convite"},
            "lead_name": {"type": "string", "description": "Nome do lead"},
        },
        "required": [],
    },
}


def _build_service():
    if not settings.GOOGLE_REFRESH_TOKEN:
        raise RuntimeError("GOOGLE_REFRESH_TOKEN não configurado")
    creds = Credentials(
        token=None,
        refresh_token=settings.GOOGLE_REFRESH_TOKEN,
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        token_uri="https://oauth2.googleapis.com/token",
        scopes=SCOPES,
    )
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def _list_slots_sync(days_ahead: int = 5) -> list[str]:
    service = _build_service()
    now = datetime.now(TZ_SP)
    min_advance = now + timedelta(hours=2)

    candidates: list[datetime] = []
    day_cursor = now.date()
    checked = 0
    while len(candidates) < days_ahead * len(SLOT_HOURS) and checked < 14:
        if day_cursor.weekday() < 5:
            for hour in SLOT_HOURS:
                slot = datetime(day_cursor.year, day_cursor.month, day_cursor.day, hour, 0, 0, tzinfo=TZ_SP)
                if slot > min_advance:
                    candidates.append(slot)
        checked += 1
        day_cursor += timedelta(days=1)

    if not candidates:
        return []

    body = {
        "timeMin": candidates[0].isoformat(),
        "timeMax": (candidates[-1] + timedelta(hours=1)).isoformat(),
        "timeZone": "America/Sao_Paulo",
        "items": [{"id": settings.GOOGLE_CALENDAR_ID}],
    }
    fb = service.freebusy().query(body=body).execute()
    busy = fb.get("calendars", {}).get(settings.GOOGLE_CALENDAR_ID, {}).get("busy", [])

    def occupied(slot: datetime) -> bool:
        slot_end = slot + timedelta(minutes=30)
        for period in busy:
            p_start = datetime.fromisoformat(period["start"]).astimezone(TZ_SP)
            p_end = datetime.fromisoformat(period["end"]).astimezone(TZ_SP)
            if slot < p_end and slot_end > p_start:
                return True
        return False

    available = [s for s in candidates if not occupied(s)]
    return [s.isoformat() for s in available[:3]]


def _create_event_sync(name: str, email: str, iso_datetime: str) -> dict:
    service = _build_service()
    start = datetime.fromisoformat(iso_datetime)
    if start.tzinfo is None:
        start = start.replace(tzinfo=TZ_SP)
    end = start + timedelta(minutes=20)

    event_body = {
        "summary": f"Diagnóstico de Captação com a Casal do Tráfego, {name or 'lead'}",
        "description": f"Lead: {name}\nEmail: {email}\nAgendada pelo agente Amanda.",
        "start": {"dateTime": start.isoformat(), "timeZone": "America/Sao_Paulo"},
        "end": {"dateTime": end.isoformat(), "timeZone": "America/Sao_Paulo"},
        "attendees": [{"email": email, "displayName": name}] if email else [],
        "conferenceData": {
            "createRequest": {
                "requestId": uuid.uuid4().hex,
                "conferenceSolutionKey": {"type": "hangoutsMeet"},
            }
        },
        "reminders": {
            "useDefault": False,
            "overrides": [
                {"method": "email", "minutes": 60},
                {"method": "popup", "minutes": 15},
            ],
        },
    }

    created = (
        service.events()
        .insert(
            calendarId=settings.GOOGLE_CALENDAR_ID,
            body=event_body,
            sendUpdates="all",
            conferenceDataVersion=1,
        )
        .execute()
    )

    return {
        "id": created.get("id", ""),
        "html_link": created.get("htmlLink", ""),
        "meet_link": created.get("hangoutLink", ""),
        "start": created.get("start", {}).get("dateTime", iso_datetime),
    }


async def execute(args: dict, context: dict) -> dict:
    preferred = (args.get("preferred_slot") or "").strip()
    lead_email = (args.get("lead_email") or "").strip()
    lead_name = (args.get("lead_name") or "").strip()
    lead_id = context.get("lead_id", "")

    loop = asyncio.get_running_loop()

    if not preferred:
        try:
            slots = await loop.run_in_executor(None, _list_slots_sync, 5)
        except Exception as exc:
            logger.error("schedule_call list slots erro: %s", exc, exc_info=True)
            return {"error": "Não consegui consultar a agenda agora. Posso tentar de novo em instantes?"}

        formatted = []
        for iso in slots:
            dt = datetime.fromisoformat(iso).astimezone(TZ_SP)
            formatted.append(
                {
                    "iso": iso,
                    "label": f"{WEEKDAYS_PT.get(dt.weekday(), '')} {dt.strftime('%d/%m às %Hh')}",
                }
            )
        return {"slots": formatted}

    if not lead_email or "@" not in lead_email:
        return {"error": "Preciso de um email válido do lead para criar o convite."}

    try:
        event = await loop.run_in_executor(None, _create_event_sync, lead_name, lead_email, preferred)
    except Exception as exc:
        logger.error("schedule_call create erro: %s", exc, exc_info=True)
        return {"error": "Não consegui criar o evento agora. Pode confirmar o horário novamente?"}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.post(
                f"{settings.CRM_BASE_URL}/api/leads/{lead_id}/book-call",
                headers={"Authorization": f"Bearer {settings.CRM_API_TOKEN}"},
                json={
                    "googleEventId": event["id"],
                    "scheduledAt": event["start"],
                    "attendeeEmail": lead_email,
                },
            )
    except Exception as exc:
        logger.error("book-call CRM falhou: %s", exc)

    return {
        "booked": True,
        "scheduled_at": event["start"],
        "link": event["html_link"],
        "meet_link": event.get("meet_link", ""),
    }
