import "server-only";
import { promises as dns } from "node:dns";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/node";

// Cache de dominios com/sem MX para nao repetir a consulta DNS.
const mxCache = new Map<string, boolean>();

/**
 * Valida um email: formato + o dominio realmente aceita email (tem registro
 * MX). Corta emails "fantasma" (ex contato@site-que-nao-existe) que viram
 * hard bounce e queimam a reputacao do remetente.
 */
export async function emailValido(email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) return false;
  const domain = e.split("@")[1];
  if (!domain) return false;
  if (mxCache.has(domain)) return mxCache.get(domain)!;
  try {
    const mx = await dns.resolveMx(domain);
    const ok = Array.isArray(mx) && mx.length > 0;
    mxCache.set(domain, ok);
    return ok;
  } catch {
    mxCache.set(domain, false);
    return false;
  }
}

// Extrai email de contato do site do lead (home + paginas de contato). Custo
// zero (fetch direto). Complementa a mineracao, que roda sem enriquecimento de
// email por velocidade: assim o canal email nao fica sem leads.

const MAILTO_RE = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
const EMAIL_RE = /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
const JUNK = [
  "sentry", "wixpress", "example", "godaddy", "no-reply", "noreply", ".png",
  ".jpg", ".jpeg", ".gif", ".webp", ".svg", "schema.org", "w3.org", "wix.com",
  "cloudflare", "jquery", "googleapis", "gstatic",
];
const JUNK_LOCAL = new Set(["email", "seu", "your", "name", "nome", "exemplo", "test", "usuario"]);

function isJunk(email: string): boolean {
  const e = email.toLowerCase();
  if (JUNK.some((j) => e.includes(j))) return true;
  return JUNK_LOCAL.has(e.split("@")[0] ?? "");
}

// Extrai (e deduplica) os emails validos de um HTML/JSON, com o mesmo filtro
// de lixo usado em todo o modulo. Reaproveitado tanto na pagina do lead
// quanto na pagina do agregador de bio-link e nos sites reais achados nela.
function extractEmailsFromHtml(html: string): string[] {
  const found: string[] = [];
  for (const m of html.matchAll(MAILTO_RE)) if (!isJunk(m[1]!)) found.push(m[1]!.toLowerCase());
  for (const m of html.matchAll(EMAIL_RE)) if (!isJunk(m[1]!)) found.push(m[1]!.toLowerCase());
  return [...new Set(found)];
}

// Dominios de agregador de bio-link (Linktree e similares). A pagina raiz
// desses sites NAO e o negocio, e uma lista de links; por isso tem tratamento
// proprio em vez de cair no guard de "nunca tem email" (wa.me, redes sociais).
const AGGREGATOR_DOMAINS = [
  "linktr.ee", "linktree", "beacons.ai", "beacons.page", "bio.link",
  "campsite.bio", "lnk.bio", "linkr.bio", "solo.to", "tap.bio",
  "flowpage.com", "milkshake.app", "msha.ke", "koji.to", "withkoji.com",
  "about.me", "carrd.co", "linkin.bio", "shor.by", "linkpop.com",
  "heylink.me", "allmylinks.com", "hoo.be", "direct.me", "contactin.bio",
];

// Hosts/trechos que nunca sao o "site real" do negocio dentro dos links de
// saida de um agregador: redes sociais, mensageria, o proprio agregador e
// assets/analytics comuns nos blobs JSON dessas paginas (Next.js etc).
const NAO_E_SITE_REAL = [
  "instagram.", "facebook.", "fb.com", "twitter.", "x.com", "threads.net",
  "linkedin.com", "tiktok.", "youtu", "pinterest.", "wa.me", "api.whatsapp",
  "whatsapp.com", "wa.link", "t.me", "google.com", "goo.gl", "spotify.com",
  "apple.com", "sentry", "wixpress", "wixstatic", "cloudflare", "jquery",
  "googleapis", "gstatic", "google-analytics", "doubleclick", "fbcdn",
  "cdninstagram", "fonts.g", "schema.org", "w3.org",
  ...AGGREGATOR_DOMAINS,
];

// Numero maximo de sites reais (achados via links de saida do agregador) que
// visitamos por lead. Mantem o custo de tempo previsivel dentro do teto da
// funcao serverless (maxDuration=300s no cron do Vercel).
const MAX_SITES_REAIS_AGREGADOR = 3;

async function fetchText(url: string): Promise<string> {
  try {
    const r = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    if (!r.ok) return "";
    const ct = r.headers.get("content-type") || "";
    if (!ct.includes("text") && !ct.includes("html")) return "";
    return await r.text();
  } catch {
    return "";
  }
}

// Visita home + paginas comuns de contato e retorna o melhor email encontrado
// (prioriza email do proprio dominio do site). Null se nao achar.
export async function extractEmailFromSite(site: string): Promise<string | null> {
  let base: string;
  let dom: string;
  let host: string;
  try {
    const u = new URL(site.startsWith("http") ? site : `https://${site}`);
    base = u.origin;
    host = u.hostname.toLowerCase();
    dom = u.hostname.replace("www.", "").split(".")[0] ?? "";
  } catch {
    return null;
  }
  const low = base.toLowerCase();

  // Agregador de bio-link (Linktree e similares): a pagina raiz nao e o site
  // do negocio, e uma lista de links. Em vez de descartar (como antes), abre
  // o agregador e tenta achar o email direto; se nao achar, segue os links de
  // saida ate o site real do negocio.
  const hostAgregador = AGGREGATOR_DOMAINS.find((d) => host.includes(d));
  if (hostAgregador) {
    const full = site.startsWith("http") ? site : `https://${site}`;
    return extractEmailFromAgregador(full, host);
  }

  if (["instagram.", "facebook.", "wa.me", "api.whatsapp", "whatsapp.com", "wa.link", "t.me", "tiktok.", "youtu", "google.com"].some((s) => low.includes(s))) {
    return null;
  }
  // Visita a URL COMPLETA do lead primeiro (muitos sites sao uma pagina
  // especifica, ex canva.site/nome-do-cliente, e o email so esta ali, nao no
  // dominio raiz). Depois tenta as paginas de contato no dominio raiz.
  const full = site.startsWith("http") ? site : `https://${site}`;
  const urls = [full];
  for (const p of ["/contato", "/contato/", "/fale-conosco", "/contact", "/quem-somos"]) {
    if (base + p !== full) urls.push(base + p);
  }
  for (const u of urls) {
    const html = await fetchText(u);
    if (!html) continue;
    const uniq = extractEmailsFromHtml(html);
    if (uniq.length) {
      return uniq.find((e) => dom && e.includes(dom)) ?? uniq[0]!;
    }
  }
  return null;
}

// Extrai os links http/https de saida de um HTML, incluindo os que estao
// dentro de blobs JSON embutidos (ex __NEXT_DATA__/application/json, comuns
// nos SPAs de agregador de bio-link). Descarta redes sociais, mensageria, o
// proprio agregador e assets/analytics, e deduplica por dominio.
function extrairLinksDeSaida(html: string, hostAgregador: string): string[] {
  const normalizado = html.replace(/\\\//g, "/"); // desescapa "https:\/\/..." de JSON
  const URL_RE = /https?:\/\/[^\s"'<>\\]+/gi;
  const vistos = new Set<string>();
  const links: string[] = [];
  for (const m of normalizado.matchAll(URL_RE)) {
    const bruto = m[0].replace(/[)\]"'.,;]+$/, "");
    let u: URL;
    try {
      u = new URL(bruto);
    } catch {
      continue;
    }
    const h = u.hostname.toLowerCase();
    if (h === hostAgregador || h.endsWith(`.${hostAgregador}`)) continue;
    if (NAO_E_SITE_REAL.some((s) => h.includes(s))) continue;
    if (/\.(png|jpe?g|gif|webp|svg|ico|css|js|woff2?|ttf|json)(\?|$)/i.test(u.pathname)) continue;
    if (vistos.has(h)) continue;
    vistos.add(h);
    links.push(u.origin + u.pathname);
  }
  return links;
}

// Pagina de um agregador de bio-link: tenta achar o email direto nela e, se
// nao achar, visita ate MAX_SITES_REAIS_AGREGADOR links de saida (o site real
// do negocio) e tenta la. Um fetch por candidato (sem crawl de paginas de
// contato) para manter o custo de tempo previsivel.
async function extractEmailFromAgregador(url: string, hostAgregador: string): Promise<string | null> {
  const html = await fetchText(url);
  if (!html) return null;
  const direto = extractEmailsFromHtml(html);
  if (direto.length) return direto[0]!;

  const candidatos = extrairLinksDeSaida(html, hostAgregador);
  for (const candidato of candidatos.slice(0, MAX_SITES_REAIS_AGREGADOR)) {
    const email = await extractEmailDeCandidato(candidato);
    if (email) return email;
  }
  return null;
}

async function extractEmailDeCandidato(url: string): Promise<string | null> {
  const html = await fetchText(url);
  if (!html) return null;
  const emails = extractEmailsFromHtml(html);
  if (!emails.length) return null;
  let dom = "";
  try {
    dom = new URL(url).hostname.replace("www.", "").split(".")[0] ?? "";
  } catch {
    // mantem dom vazio, usa o primeiro email encontrado
  }
  return emails.find((e) => dom && e.includes(dom)) ?? emails[0]!;
}

type PendenteRow = { id: string; website: string };

/**
 * Enriquece ate `limite` leads qualified da org que tem site mas nao tem email:
 * abre o site, extrai o email e grava. Processa em lotes concorrentes.
 * Retorna quantos emails foram gravados.
 */
export async function enriquecerEmailsDoPool(
  organizationId: string,
  limite = 300,
): Promise<number> {
  // IMPORTANTE: excluir tambem wa.me / api.whatsapp / whatsapp.com / wa.link /
  // t.me / tiktok / youtube / google.com. A mineracao do Google Maps grava o
  // botao de WhatsApp do perfil como "website"; esses links NUNCA tem email e,
  // se entrarem no pool, consomem as vagas da rodada e cegam o enriquecimento
  // (foi o que zerou o canal email a partir de 2026-07-24).
  // Linktree e outros agregadores de bio-link (Instagram) NAO sao mais
  // excluidos aqui: extractEmailFromSite agora abre o agregador e segue os
  // links de saida ate o site real do negocio, entao entrar no pool e util.
  const rows = await db.execute<PendenteRow>(sql`
    SELECT l.id, l.website
    FROM leads l
    WHERE l.organization_id = ${organizationId}
      AND l.deleted_at IS NULL
      AND l.qualification_status = 'qualified'
      AND (l.email = '' OR l.email IS NULL)
      AND l.website IS NOT NULL AND l.website <> ''
      AND l.website NOT ILIKE '%instagram%'
      AND l.website NOT ILIKE '%facebook%'
      AND l.website NOT ILIKE '%wa.me%'
      AND l.website NOT ILIKE '%api.whatsapp%'
      AND l.website NOT ILIKE '%whatsapp.com%'
      AND l.website NOT ILIKE '%wa.link%'
      AND l.website NOT ILIKE '%t.me/%'
      AND l.website NOT ILIKE '%tiktok%'
      AND l.website NOT ILIKE '%youtu%'
      AND l.website NOT ILIKE '%google.com%'
    ORDER BY l.qualified_at DESC NULLS LAST
    LIMIT ${limite}
  `);
  const leads = Array.from(rows);
  if (leads.length === 0) return 0;

  let found = 0;
  const CONC = 10;
  for (let i = 0; i < leads.length; i += CONC) {
    const batch = leads.slice(i, i + CONC);
    const res = await Promise.all(
      batch.map(async (l) => ({ id: l.id, email: await extractEmailFromSite(l.website) })),
    );
    for (const r of res) {
      if (r.email && (await emailValido(r.email))) {
        await db.execute(sql`
          UPDATE leads SET email = ${r.email}, updated_at = now() WHERE id = ${r.id}
        `);
        found++;
      }
    }
  }
  console.log(
    `[enrich.email] org=${organizationId} processados=${leads.length} emails=${found}`,
  );
  return found;
}
