import "server-only";
import { google, type Auth } from "googleapis";
import { getAuthedClient } from "@/lib/clients/gmail";

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

// Brasil nao observa horario de verao desde 2019. SP e permanentemente UTC-3.
const SP_OFFSET_MS = -3 * 60 * 60 * 1000;

// Horas de trabalho oferecidas ao lead (espelhando o lista).
const SLOT_HOURS = [9, 10, 11, 14, 15, 16, 17];

const WEEKDAYS_PT: Record<number, string> = {
  0: "Domingo",
  1: "Segunda",
  2: "Terca",
  3: "Quarta",
  4: "Quinta",
  5: "Sexta",
  6: "Sabado",
};

export type TimeSlot = {
  start: string;
  end: string;
};

/** Slot sugerido com label em portugues, espelhando schedule_call do lista. */
export type CalendarSuggestedSlot = {
  /** ISO 8601 com offset -03:00, ex: 2026-06-29T10:00:00-03:00 */
  iso: string;
  /** Label amigavel em portugues, ex: "Segunda 29/06 as 10h" */
  label: string;
};

export type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  htmlLink: string;
  meetLink?: string;
};

export class CalendarNotConfiguredError extends Error {
  constructor() {
    super("Google Calendar nao autorizado para esta organizacao. Reconecte o Gmail com permissao de Calendar.");
    this.name = "CalendarNotConfiguredError";
  }
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

function toISO(date: Date): string {
  return date.toISOString();
}

/**
 * Retorna os componentes de data/hora em America/Sao_Paulo a partir de um Date UTC.
 * Como SP e UTC-3 permanentemente, aplicamos o offset diretamente.
 */
function spComponents(utcDate: Date): { year: number; month: number; day: number; hour: number; weekday: number } {
  const spMs = utcDate.getTime() + SP_OFFSET_MS;
  const sp = new Date(spMs);
  return {
    year: sp.getUTCFullYear(),
    month: sp.getUTCMonth() + 1,
    day: sp.getUTCDate(),
    hour: sp.getUTCHours(),
    weekday: sp.getUTCDay(), // 0=Dom, 1=Seg ... 6=Sab
  };
}

/** Constroi um Date UTC a partir de componentes locais SP. */
function spToUTC(year: number, month: number, day: number, hour: number, minute: number): Date {
  // SP = UTC + offset => UTC = SP - offset => UTC = SP + 3h
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute, 0));
}

/** Constroi ISO 8601 com offset -03:00 a partir de componentes SP. */
function spToIso(year: number, month: number, day: number, hour: number, minute: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00-03:00`;
}

async function getOAuth(organizationId: string): Promise<Auth.OAuth2Client> {
  try {
    const authed = await getAuthedClient(organizationId);
    return authed.oauth as Auth.OAuth2Client;
  } catch {
    throw new CalendarNotConfiguredError();
  }
}

/**
 * Verifica slots livres num dia especifico (YYYY-MM-DD) em America/Sao_Paulo.
 * Retorna até 6 slots no formato UTC ISO (para exibicao formatada pelo chamador).
 *
 * CORRECAO: usa offset -03:00 explicito para que o Date parse o horario como SP,
 * nao como UTC do servidor (bug original em ambientes Vercel/VPS rodando em UTC).
 */
export async function checkCalendarAvailability(
  organizationId: string,
  date: string,
  durationMinutes = 20,
  workdayStart = 8,
  workdayEnd = 18,
): Promise<TimeSlot[]> {
  const oauth = await getOAuth(organizationId);
  const calendar = google.calendar({ version: "v3", auth: oauth });

  // Explicito -03:00 para garantir que o parser nao use o fuso do servidor
  const pad = (n: number) => String(n).padStart(2, "0");
  const dayStart = new Date(`${date}T${pad(workdayStart)}:00:00-03:00`);
  const dayEnd = new Date(`${date}T${pad(workdayEnd)}:00:00-03:00`);

  let busyPeriods: Array<{ start: string; end: string }> = [];
  try {
    const freebusyRes = await calendar.freebusy.query({
      requestBody: {
        timeMin: toISO(dayStart),
        timeMax: toISO(dayEnd),
        timeZone: "America/Sao_Paulo",
        items: [{ id: "primary" }],
      },
    });
    busyPeriods = (freebusyRes.data.calendars?.["primary"]?.busy ?? []) as Array<{ start: string; end: string }>;
  } catch {
    throw new CalendarNotConfiguredError();
  }

  const available: TimeSlot[] = [];
  let cursor = new Date(dayStart);

  while (cursor < dayEnd) {
    const slotEnd = addMinutes(cursor, durationMinutes);
    if (slotEnd > dayEnd) break;

    const overlaps = busyPeriods.some((busy) => {
      const bStart = new Date(busy.start);
      const bEnd = new Date(busy.end);
      return cursor < bEnd && slotEnd > bStart;
    });

    if (!overlaps) {
      available.push({
        start: toISO(cursor),
        end: toISO(slotEnd),
      });
    }

    cursor = addMinutes(cursor, durationMinutes);
  }

  return available.slice(0, 6);
}

/**
 * Escaneia os proximos dias uteis e retorna os 3 primeiros slots disponiveis,
 * com labels em portugues para o agente oferecer ao lead.
 *
 * Espelha _list_slots_sync do agente_minerador_lista (schedule_call.py):
 * - Horas: SLOT_HOURS [9,10,11,14,15,16,17]
 * - Dias uteis: segunda a sexta
 * - Antecedencia minima: 2 horas a partir de agora
 * - Verifica free/busy numa unica chamada para todo o range
 * - Retorna max 3 slots
 */
export async function scanCalendarSlots(
  organizationId: string,
  daysAhead = 5,
  durationMinutes = 20,
): Promise<CalendarSuggestedSlot[]> {
  const oauth = await getOAuth(organizationId);
  const calendar = google.calendar({ version: "v3", auth: oauth });

  const now = new Date();
  const minStart = new Date(now.getTime() + 2 * 60 * 60 * 1000); // +2h de antecedencia

  // Construir candidatos: iteramos dias a partir de hoje (meio-dia SP)
  const nowSP = spComponents(now);
  // Iniciar cursor no meio-dia SP de hoje para navegacao dia a dia sem risco de overflow
  let cursorUTC = spToUTC(nowSP.year, nowSP.month, nowSP.day, 12, 0);

  const candidates: Array<{
    iso: string;
    utc: Date;
    year: number;
    month: number;
    day: number;
    hour: number;
    weekday: number;
  }> = [];

  let checked = 0;
  while (candidates.length < daysAhead * SLOT_HOURS.length && checked < 14) {
    const cs = spComponents(cursorUTC);

    if (cs.weekday >= 1 && cs.weekday <= 5) { // Seg-Sex
      for (const hour of SLOT_HOURS) {
        const utc = spToUTC(cs.year, cs.month, cs.day, hour, 0);
        if (utc > minStart) {
          candidates.push({
            iso: spToIso(cs.year, cs.month, cs.day, hour, 0),
            utc,
            year: cs.year,
            month: cs.month,
            day: cs.day,
            hour,
            weekday: cs.weekday,
          });
        }
      }
    }

    // Avanca um dia (24h UTC, correto pois SP nao tem DST)
    cursorUTC = new Date(cursorUTC.getTime() + 24 * 60 * 60 * 1000);
    checked++;
  }

  if (candidates.length === 0) return [];

  // Uma unica chamada freebusy para todo o range
  const timeMin = candidates[0].utc.toISOString();
  const timeMax = new Date(
    candidates[candidates.length - 1].utc.getTime() + durationMinutes * 60000,
  ).toISOString();

  let busyPeriods: Array<{ start: string; end: string }> = [];
  try {
    const fbRes = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        timeZone: "America/Sao_Paulo",
        items: [{ id: "primary" }],
      },
    });
    busyPeriods = (fbRes.data.calendars?.["primary"]?.busy ?? []) as Array<{ start: string; end: string }>;
  } catch {
    throw new CalendarNotConfiguredError();
  }

  function isOccupied(slotStart: Date): boolean {
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60000);
    return busyPeriods.some((b) => {
      const bStart = new Date(b.start);
      const bEnd = new Date(b.end);
      return slotStart < bEnd && slotEnd > bStart;
    });
  }

  const available = candidates.filter((c) => !isOccupied(c.utc));

  return available.slice(0, 3).map((c) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const label = `${WEEKDAYS_PT[c.weekday] ?? ""} ${pad(c.day)}/${pad(c.month)} as ${c.hour}h`;
    return { iso: c.iso, label };
  });
}

export async function createCalendarEvent(
  organizationId: string,
  opts: {
    summary: string;
    description?: string;
    startTime: string;
    endTime: string;
    attendeeEmail?: string;
    attendeeName?: string;
    addMeet?: boolean;
  },
): Promise<CalendarEvent> {
  const oauth = await getOAuth(organizationId);
  const calendar = google.calendar({ version: "v3", auth: oauth });

  const attendees = opts.attendeeEmail
    ? [{ email: opts.attendeeEmail, displayName: opts.attendeeName ?? undefined }]
    : [];

  const conferenceData = opts.addMeet !== false
    ? {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      }
    : undefined;

  const res = await calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: opts.addMeet !== false ? 1 : 0,
    sendUpdates: attendees.length > 0 ? "all" : "none",
    requestBody: {
      summary: opts.summary,
      description: opts.description,
      start: { dateTime: opts.startTime, timeZone: "America/Sao_Paulo" },
      end: { dateTime: opts.endTime, timeZone: "America/Sao_Paulo" },
      attendees,
      conferenceData,
      // Lembretes: email 60min antes + popup 15min antes (espelho do lista)
      reminders: {
        useDefault: false,
        overrides: [
          { method: "email", minutes: 60 },
          { method: "popup", minutes: 15 },
        ],
      },
    },
  });

  const data = res.data;
  if (!data.id) throw new Error("Google Calendar nao retornou id do evento");

  const meetLink =
    data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")
      ?.uri ?? undefined;

  return {
    id: data.id,
    summary: data.summary ?? opts.summary,
    start: data.start?.dateTime ?? opts.startTime,
    end: data.end?.dateTime ?? opts.endTime,
    htmlLink: data.htmlLink ?? "",
    meetLink,
  };
}
