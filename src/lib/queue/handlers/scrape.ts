import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { miningSources } from "@/db/schema/minings";
import { scrapingJobs } from "@/db/schema/jobs";
import type { PlaceLead } from "@/lib/clients/google-places";
import type { IgLead, LinkedInProfile } from "@/lib/clients/apify";
import {
  searchLinkedInViaApify,
  searchInstagramViaApify,
} from "@/lib/clients/apify";
import { searchGoogleMapsViaScrapling } from "@/lib/clients/scrapling";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type {
  NormalizedLead,
  ScrapeIngestPayload,
  ScrapeRunPayload,
} from "@/lib/queue/types";

type GooglePlacesConfig = {
  query: string;
  location?: string;
  // Varias cidades: minera cada uma e agrega. Se ausente, usa `location`.
  locations?: string[];
  radius?: number;
  maxResults?: number;
  // Liga a extracao de email do site de cada lead. So para nichos roteados ao
  // canal de email (setado pelo planner da automacao diaria).
  fetchWebsiteEmail?: boolean;
};

type InstagramConfig = {
  search: string;
  maxResults?: number;
  onlyBrazil?: boolean;
};

type LinkedInSearchConfig = {
  query: string;
  maxResults?: number;
  location?: string;
};

function isGooglePlacesConfig(c: unknown): c is GooglePlacesConfig {
  return (
    typeof c === "object" &&
    c !== null &&
    typeof (c as Record<string, unknown>).query === "string"
  );
}

function isInstagramConfig(c: unknown): c is InstagramConfig {
  return (
    typeof c === "object" &&
    c !== null &&
    typeof (c as Record<string, unknown>).search === "string"
  );
}

function isLinkedInSearchConfig(c: unknown): c is LinkedInSearchConfig {
  return (
    typeof c === "object" &&
    c !== null &&
    typeof (c as Record<string, unknown>).query === "string"
  );
}

async function fetchGooglePlaces(cfg: GooglePlacesConfig): Promise<PlaceLead[]> {
  const maxPerCity = cfg.maxResults ?? 60;
  const cities =
    cfg.locations && cfg.locations.length > 0
      ? cfg.locations
      : [cfg.location];

  // Uma cidade so: caminho direto (rapido). Varias: minera em lotes de 2
  // (concorrencia controlada p/ nao sobrecarregar o Scrapling), maxResults por
  // cidade, e agrega tudo. Dedup final na ingestao (onConflictDoNothing).
  if (cities.length <= 1) {
    return searchGoogleMapsViaScrapling({
      query: cfg.query,
      location: cities[0] ?? undefined,
      maxResults: maxPerCity,
      fetchWebsiteEmail: cfg.fetchWebsiteEmail,
    });
  }

  const all: PlaceLead[] = [];
  const CONCURRENCY = 2;
  for (let i = 0; i < cities.length; i += CONCURRENCY) {
    const batch = cities.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((loc) =>
        searchGoogleMapsViaScrapling({
          query: cfg.query,
          location: loc ?? undefined,
          maxResults: maxPerCity,
          fetchWebsiteEmail: cfg.fetchWebsiteEmail,
        }),
      ),
    );
    for (const r of results) {
      if (r.status === "fulfilled") all.push(...r.value);
      else console.error("[scrape.run] cidade falhou no google:", r.reason);
    }
  }
  return all;
}

async function fetchInstagramProfiles(
  organizationId: string,
  cfg: InstagramConfig,
  searchType: "user" | "hashtag",
): Promise<IgLead[]> {
  return searchInstagramViaApify(organizationId, {
    search: cfg.search,
    searchType,
    maxResults: cfg.maxResults ?? 30,
    // default true: filtra Brasil. Frontend pode desligar para outros paises.
    onlyBrazil: cfg.onlyBrazil !== false,
  });
}

async function fetchLinkedInProfiles(
  organizationId: string,
  cfg: LinkedInSearchConfig,
): Promise<LinkedInProfile[]> {
  return searchLinkedInViaApify(organizationId, {
    query: cfg.query,
    maxResults: cfg.maxResults ?? 50,
    location: cfg.location ?? null,
  });
}

// Processa UMA fonte da mineracao (scraping + enfileira ingest). Extraido para
// permitir rodar todas as fontes de uma mineracao EM PARALELO no handleScrapeRun.
async function processSource(
  organizationId: string,
  miningId: string,
  sourceId: string,
): Promise<void> {
  const sourceRows = await db
    .select()
    .from(miningSources)
    .where(
      and(
        eq(miningSources.id, sourceId),
        eq(miningSources.organizationId, organizationId),
      ),
    )
    .limit(1);

  const source = sourceRows[0];
  if (!source) {
    throw new Error(`mining_source ${sourceId} nao encontrado`);
  }

  const [job] = await db
    .insert(scrapingJobs)
    .values({
      organizationId,
      miningId,
      sourceType: source.type,
      input: source.config,
      status: "running",
      startedAt: new Date(),
    })
    .returning({ id: scrapingJobs.id });

  if (!job) {
    throw new Error("falha ao criar scraping_job");
  }

  try {
    let leads: NormalizedLead[] = [];
    let sourceTypeForIngest: ScrapeIngestPayload["sourceType"] = "google_places";

    if (source.type === "google_places") {
      if (!isGooglePlacesConfig(source.config)) {
        throw new Error("config invalida para google_places");
      }
      const places = await fetchGooglePlaces(source.config);
      leads = places.map((p) => ({
        source: "google_places",
        externalId: p.placeId,
        displayName: p.name,
        handle: null,
        website: p.website,
        phone: p.phone,
        email: p.email,
        city: p.city,
        region: p.state,
        country: p.country,
        rawData: p as unknown as Record<string, unknown>,
      }));
      sourceTypeForIngest = "google_places";
    } else if (
      source.type === "instagram_hashtag" ||
      source.type === "instagram_profile"
    ) {
      if (!isInstagramConfig(source.config)) {
        throw new Error("config invalida para instagram");
      }
      // Instagram sempre busca PERFIS (user) por palavra-chave: sao eles que
      // trazem bio, link e contato de leads. Buscar por hashtag traria posts,
      // que nao servem como lead. O wizard cria instagram_hashtag mas a
      // intencao do usuario e achar perfis do nicho.
      const profiles = await fetchInstagramProfiles(organizationId, source.config, "user");
      leads = profiles.map((p) => ({
        source: "instagram",
        externalId: p.username,
        displayName: p.fullName ?? p.username,
        handle: p.username,
        website: p.externalUrl,
        phone: p.phone,
        email: p.email,
        city: null,
        region: null,
        country: null,
        rawData: p as unknown as Record<string, unknown>,
      }));
      sourceTypeForIngest = "apify_instagram";
    } else if (source.type === "linkedin_search") {
      if (!isLinkedInSearchConfig(source.config)) {
        throw new Error("config invalida para linkedin_search");
      }
      const profiles = await fetchLinkedInProfiles(organizationId, source.config);
      leads = profiles.map((p) => ({
        source: "linkedin",
        externalId: p.publicIdentifier,
        displayName: p.fullName ?? p.publicIdentifier,
        handle: p.publicIdentifier,
        website: null,
        phone: p.phone,
        email: p.email,
        city: p.location,
        region: null,
        country: null,
        linkedinUrl: p.linkedinUrl,
        headline: p.headline,
        company: p.company,
        rawData: p as unknown as Record<string, unknown>,
      }));
      sourceTypeForIngest = "linkedin_search";
    } else {
      throw new Error(`source type ${source.type} nao suportado`);
    }

    await db
      .update(scrapingJobs)
      .set({
        leadsFound: leads.length,
        status: "completed",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scrapingJobs.id, job.id));

    await db
      .update(miningSources)
      .set({ lastRunAt: new Date(), updatedAt: new Date() })
      .where(eq(miningSources.id, sourceId));

    if (leads.length > 0) {
      const boss = await getBoss();
      const ingestPayload: ScrapeIngestPayload = {
        organizationId,
        miningId,
        sourceType: sourceTypeForIngest,
        scrapingJobId: job.id,
        leads,
      };
      await boss.send(QUEUES.scrapeIngest, ingestPayload);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(scrapingJobs)
      .set({
        status: "failed",
        error: message,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(scrapingJobs.id, job.id));
    throw err;
  }
}

// Handler da fila scrape.run.
// - payload com sourceId: processa aquela fonte (re-disparo individual, compat).
// - payload sem sourceId: processa TODAS as fontes da mineracao EM PARALELO, num
//   unico job. Isso garante que Google (lento) e LinkedIn/Instagram (rapidos)
//   rodem juntos, sem uma segurar a outra na fila. Uma fonte que falha nao
//   derruba as demais (allSettled).
export async function handleScrapeRun(payload: ScrapeRunPayload): Promise<void> {
  const { organizationId, miningId, sourceId } = payload;

  if (sourceId) {
    await processSource(organizationId, miningId, sourceId);
    return;
  }

  const sources = await db
    .select({ id: miningSources.id })
    .from(miningSources)
    .where(
      and(
        eq(miningSources.miningId, miningId),
        eq(miningSources.organizationId, organizationId),
      ),
    );

  const results = await Promise.allSettled(
    sources.map((s) => processSource(organizationId, miningId, s.id)),
  );
  const rejected = results.filter((r) => r.status === "rejected");
  if (rejected.length > 0) {
    console.error(
      `[scrape.run] ${rejected.length}/${sources.length} fontes falharam na mineracao ${miningId}`,
    );
  }
}
