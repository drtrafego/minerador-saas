import { getOrgCredential } from "@/lib/credentials/get";
import type { NormalizedLead } from "@/lib/queue/types";

const BASE_URL = "https://nubela.co/proxycurl/api";
const ENRICH_DELAY_MS = 300;

export type ProxycurlErrorKind =
  | "auth"
  | "credit"
  | "rate"
  | "not_found"
  | "bad_request"
  | "network"
  | "unknown";

export class ProxycurlError extends Error {
  readonly kind: ProxycurlErrorKind;
  readonly status: number | null;
  constructor(kind: ProxycurlErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "ProxycurlError";
    this.kind = kind;
    this.status = status;
  }
}

function mapStatus(status: number): ProxycurlErrorKind {
  if (status === 401) return "auth";
  if (status === 402) return "credit";
  if (status === 404) return "not_found";
  if (status === 429) return "rate";
  if (status >= 400 && status < 500) return "bad_request";
  return "unknown";
}

export async function loadProxycurlKey(
  organizationId: string,
): Promise<{ apiKey: string }> {
  const cred = await getOrgCredential(organizationId, "proxycurl");
  return { apiKey: cred.apiKey };
}

type FetchOpts = {
  apiKey: string;
  path: string;
  params: Record<string, string | number | undefined>;
};

async function callProxycurl<T>(opts: FetchOpts): Promise<T> {
  const url = new URL(`${BASE_URL}${opts.path}`);
  for (const [key, value] of Object.entries(opts.params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ProxycurlError("network", `falha de rede na proxycurl: ${message}`);
  }

  if (!resp.ok) {
    const kind = mapStatus(resp.status);
    let detail = "";
    try {
      detail = await resp.text();
    } catch {
      detail = "";
    }
    throw new ProxycurlError(
      kind,
      `proxycurl ${opts.path} respondeu ${resp.status}: ${detail.slice(0, 200)}`,
      resp.status,
    );
  }

  return (await resp.json()) as T;
}

type RawSearchResult = {
  linkedin_profile_url?: string;
  last_updated?: string;
};

type RawSearchResponse = {
  results?: RawSearchResult[];
  next_page?: string | null;
};

export type LinkedInSearchHit = {
  linkedinUrl: string;
  lastUpdated: string | null;
};

type SearchArgs =
  | {
      organizationId: string;
      query: string;
      maxResults?: number;
    }
  | {
      organizationId: string;
      roleTitle?: string;
      companyName?: string;
      headline?: string;
      country?: string;
      region?: string;
      maxResults?: number;
    };

function hasQuery(
  args: SearchArgs,
): args is { organizationId: string; query: string; maxResults?: number } {
  return typeof (args as { query?: unknown }).query === "string";
}

export async function searchLinkedInPeople(
  args: SearchArgs,
): Promise<LinkedInSearchHit[]> {
  const { apiKey } = await loadProxycurlKey(args.organizationId);
  const maxResults = Math.max(1, Math.min(args.maxResults ?? 10, 50));

  const params: Record<string, string | number | undefined> = {
    page_size: maxResults,
  };

  if (hasQuery(args)) {
    params.headline = args.query;
    params.country = "BR";
  } else {
    params.current_role_title = args.roleTitle;
    params.current_company_name = args.companyName;
    params.headline = args.headline;
    params.country = args.country ?? "BR";
    params.region = args.region;
  }

  const data = await callProxycurl<RawSearchResponse>({
    apiKey,
    path: "/v2/search/person",
    params,
  });

  const results = Array.isArray(data.results) ? data.results : [];
  const hits: LinkedInSearchHit[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    const url = typeof r.linkedin_profile_url === "string" ? r.linkedin_profile_url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    hits.push({
      linkedinUrl: url,
      lastUpdated: typeof r.last_updated === "string" ? r.last_updated : null,
    });
    if (hits.length >= maxResults) break;
  }
  return hits;
}

type RawExperience = {
  company?: string;
  title?: string;
};

type RawProfile = {
  full_name?: string;
  public_identifier?: string;
  headline?: string;
  occupation?: string;
  country?: string;
  country_full_name?: string;
  city?: string;
  experiences?: RawExperience[];
};

export type LinkedInProfile = {
  linkedinUrl: string;
  fullName: string | null;
  publicIdentifier: string | null;
  headline: string | null;
  occupation: string | null;
  company: string | null;
  country: string | null;
  city: string | null;
};

function extractPublicIdentifierFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("in");
    if (idx >= 0 && parts[idx + 1]) return parts[idx + 1] ?? null;
    return parts[parts.length - 1] ?? null;
  } catch {
    return null;
  }
}

export async function getLinkedInProfile(args: {
  organizationId: string;
  linkedinUrl: string;
}): Promise<LinkedInProfile> {
  const { apiKey } = await loadProxycurlKey(args.organizationId);
  const data = await callProxycurl<RawProfile>({
    apiKey,
    path: "/v2/linkedin",
    params: { url: args.linkedinUrl },
  });

  const experiences = Array.isArray(data.experiences) ? data.experiences : [];
  const firstExperience = experiences[0];
  const company =
    typeof firstExperience?.company === "string" && firstExperience.company.trim()
      ? firstExperience.company.trim()
      : null;

  const publicIdentifier =
    typeof data.public_identifier === "string" && data.public_identifier.trim()
      ? data.public_identifier.trim()
      : extractPublicIdentifierFromUrl(args.linkedinUrl);

  const country =
    typeof data.country_full_name === "string" && data.country_full_name.trim()
      ? data.country_full_name.trim()
      : typeof data.country === "string"
        ? data.country
        : null;

  return {
    linkedinUrl: args.linkedinUrl,
    fullName: typeof data.full_name === "string" ? data.full_name : null,
    publicIdentifier,
    headline: typeof data.headline === "string" ? data.headline : null,
    occupation: typeof data.occupation === "string" ? data.occupation : null,
    company,
    country,
    city: typeof data.city === "string" ? data.city : null,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type SearchAndEnrichArgs =
  | {
      organizationId: string;
      query: string;
      maxResults?: number;
    }
  | {
      organizationId: string;
      roleTitle?: string;
      companyName?: string;
      headline?: string;
      country?: string;
      region?: string;
      maxResults?: number;
    };

export async function searchAndEnrich(
  args: SearchAndEnrichArgs,
): Promise<NormalizedLead[]> {
  const maxResults = Math.max(1, Math.min(args.maxResults ?? 10, 50));

  const hits = await searchLinkedInPeople({
    ...(args as object),
    maxResults,
  } as SearchArgs);

  const limited = hits.slice(0, maxResults);
  const leads: NormalizedLead[] = [];

  for (let i = 0; i < limited.length; i++) {
    const hit = limited[i];
    if (!hit) continue;
    try {
      const profile = await getLinkedInProfile({
        organizationId: args.organizationId,
        linkedinUrl: hit.linkedinUrl,
      });

      const externalId =
        profile.publicIdentifier ??
        extractPublicIdentifierFromUrl(hit.linkedinUrl) ??
        hit.linkedinUrl;

      leads.push({
        source: "linkedin",
        externalId,
        displayName: profile.fullName ?? externalId,
        handle: profile.publicIdentifier ?? externalId,
        website: null,
        phone: null,
        email: null,
        city: profile.city,
        region: null,
        country: profile.country,
        linkedinUrl: hit.linkedinUrl,
        headline: profile.headline ?? profile.occupation,
        company: profile.company,
        rawData: {
          profile,
          lastUpdated: hit.lastUpdated,
        },
      });
    } catch (err) {
      if (err instanceof ProxycurlError && (err.kind === "credit" || err.kind === "auth" || err.kind === "rate")) {
        throw err;
      }
      console.warn(
        `[proxycurl] falha ao enriquecer ${hit.linkedinUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (i < limited.length - 1) {
      await delay(ENRICH_DELAY_MS);
    }
  }

  return leads;
}
