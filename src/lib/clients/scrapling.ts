import type { IgLead, LinkedInProfile } from "@/lib/clients/apify";
import type { PlaceLead } from "@/lib/clients/google-places";

export class ScraplingError extends Error {
  constructor(
    message: string,
    public code: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ScraplingError";
  }
}

export class ScraplingTimeoutError extends ScraplingError {
  constructor() {
    super("scrapling timeout", "timeout");
  }
}

type ClientOpts = { timeoutMs?: number };

type RawResponse = { ok: boolean; data?: unknown[]; error?: { code: string; message: string } };

async function call<T>(path: string, body: unknown, opts: ClientOpts = {}): Promise<T[]> {
  const url = process.env.SCRAPLING_URL;
  const secret = process.env.SCRAPLING_SHARED_SECRET;
  if (!url) throw new ScraplingError("SCRAPLING_URL nao configurado", "config");
  if (!secret) throw new ScraplingError("SCRAPLING_SHARED_SECRET nao configurado", "config");

  const timeoutMs = opts.timeoutMs ?? 330_000;
  const maxAttempts = 2;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${url}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Scrapling-Secret": secret,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const payload = (await res.json().catch(() => ({}))) as RawResponse;
      if (res.ok && payload.ok && Array.isArray(payload.data)) {
        return payload.data as T[];
      }
      if (res.status === 401 || res.status === 403) {
        throw new ScraplingError("scrapling auth rejeitado", "auth", res.status);
      }
      if (res.status === 429) {
        throw new ScraplingError("scrapling bloqueado/rate-limited", "blocked", res.status);
      }
      if (res.status < 500 && res.status !== 408) {
        throw new ScraplingError(
          payload.error?.message ?? `scrapling http ${res.status}`,
          payload.error?.code ?? "client",
          res.status,
        );
      }
      lastErr = new ScraplingError(
        payload.error?.message ?? `scrapling http ${res.status}`,
        payload.error?.code ?? "upstream",
        res.status,
      );
    } catch (err) {
      if (err instanceof ScraplingError) {
        if (err.code === "auth" || err.code === "blocked") throw err;
        lastErr = err;
      } else if (err instanceof DOMException && err.name === "TimeoutError") {
        lastErr = new ScraplingTimeoutError();
      } else {
        lastErr = err;
      }
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new ScraplingError("scrapling erro desconhecido", "unknown");
}

type RawLinkedInProfile = {
  public_identifier: string;
  full_name: string | null;
  headline: string | null;
  location: string | null;
  company: string | null;
  linkedin_url: string | null;
};

type RawPlaceLead = {
  place_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  types: string[];
  location: { lat: number; lng: number } | null;
  raw: Record<string, unknown>;
};

type RawIgLead = {
  username: string;
  full_name: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  posts_count: number | null;
  category: string | null;
  external_url: string | null;
  is_business_account: boolean | null;
  profile_pic_url: string | null;
  email: string | null;
  phone: string | null;
  raw: Record<string, unknown>;
};

export async function searchLinkedInViaScrapling(opts: {
  query: string;
  maxResults: number;
  location?: string | null;
  timeoutMs?: number;
}): Promise<LinkedInProfile[]> {
  const rows = await call<RawLinkedInProfile>(
    "/v1/linkedin/search",
    {
      query: opts.query,
      max_results: opts.maxResults,
      location: opts.location ?? null,
      timeout_ms: opts.timeoutMs ?? 120_000,
    },
    { timeoutMs: opts.timeoutMs ? opts.timeoutMs + 10_000 : undefined },
  );
  return rows.map((r) => ({
    publicIdentifier: r.public_identifier,
    fullName: r.full_name,
    headline: r.headline,
    location: r.location,
    company: r.company,
    linkedinUrl: r.linkedin_url,
    email: null,
    phone: null,
  }));
}

export async function searchGoogleMapsViaScrapling(opts: {
  query: string;
  location?: string;
  maxResults: number;
  timeoutMs?: number;
  fetchWebsiteEmail?: boolean;
}): Promise<PlaceLead[]> {
  // fetch_website_email so e ligado para nichos roteados ao canal de email
  // (advogado, clinica, etc): abre o site de cada lead para garimpar email.
  // Para restaurante/WhatsApp fica desligado, porque o Google ja traz telefone
  // e abrir todo site so atrasa. A extracao no Scrapling ja e robusta (pula
  // redes sociais, timeout curto), entao ligar aqui nao trava a mineracao.
  const pythonTimeout = opts.timeoutMs ?? 420_000;
  const rows = await call<RawPlaceLead>(
    "/v1/google-maps/search",
    {
      query: opts.query,
      location: opts.location ?? null,
      max_results: opts.maxResults,
      fetch_website_email: opts.fetchWebsiteEmail === true,
      timeout_ms: pythonTimeout,
    },
    { timeoutMs: pythonTimeout + 10_000 },
  );
  return rows.map((r) => ({
    placeId: r.place_id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    website: r.website,
    address: r.address,
    city: r.city,
    state: r.state,
    country: r.country,
    rating: r.rating,
    userRatingsTotal: r.user_ratings_total,
    types: r.types ?? [],
    location: r.location,
    raw: r.raw ?? {},
  }));
}

export async function searchInstagramViaScrapling(opts: {
  search: string;
  searchType?: "user" | "hashtag";
  maxResults: number;
  timeoutMs?: number;
}): Promise<IgLead[]> {
  // enrich_profiles ativo por padrao: visita cada perfil do Instagram para extrair email/phone business.
  // timeout_ms=180_000 cobre dork DuckDuckGo (~20s) + enriquecimento (semaphore=5, 6s cada, 30 leads => ate ~36s).
  // AbortSignal = timeout_ms + 10_000 para garantir que o Python termina antes do Node cortar a conexao.
  const pythonTimeout = opts.timeoutMs ?? 180_000;
  const rows = await call<RawIgLead>(
    "/v1/instagram/search",
    {
      search: opts.search,
      search_type: opts.searchType ?? "user",
      max_results: opts.maxResults,
      enrich_profiles: true,
      timeout_ms: pythonTimeout,
    },
    { timeoutMs: pythonTimeout + 10_000 },
  );
  return rows.map((r) => ({
    username: r.username,
    fullName: r.full_name,
    bio: r.bio,
    followers: r.followers,
    following: r.following,
    postsCount: r.posts_count,
    category: r.category,
    externalUrl: r.external_url,
    isBusinessAccount: r.is_business_account,
    profilePicUrl: r.profile_pic_url,
    email: r.email,
    phone: r.phone,
    raw: r.raw ?? {},
  }));
}

export async function pingScrapling(): Promise<boolean> {
  const url = process.env.SCRAPLING_URL;
  if (!url) return false;
  try {
    const res = await fetch(`${url}/v1/health`, { signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}
