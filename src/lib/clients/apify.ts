import { getOrgCredential } from "@/lib/credentials/get";

export type IgLead = {
  username: string;
  fullName: string | null;
  bio: string | null;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
  category: string | null;
  externalUrl: string | null;
  isBusinessAccount: boolean | null;
  profilePicUrl: string | null;
  email: string | null;
  phone: string | null;
  raw: Record<string, unknown>;
};

export type LinkedInProfile = {
  publicIdentifier: string;
  fullName: string | null;
  headline: string | null;
  location: string | null;
  company: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
};

// Actors da Apify usados para minerar (formato username~name).
const LINKEDIN_ACTOR = "harvestapi~linkedin-profile-search";
const INSTAGRAM_ACTOR = "apify~instagram-scraper";

export class ApifyError extends Error {
  constructor(
    message: string,
    public code: string,
    public status?: number,
  ) {
    super(message);
    this.name = "ApifyError";
  }
}

// Roda um actor de forma sincrona e retorna os itens do dataset ja prontos.
// https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post
async function runActor<T>(
  actor: string,
  token: string,
  input: unknown,
  opts: { timeoutMs?: number; maxItems?: number; maxTotalChargeUsd?: number } = {},
): Promise<T[]> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  // timeout do lado do Apify em segundos (deixa margem sobre o AbortSignal do Node)
  const apifyTimeoutSecs = Math.floor(timeoutMs / 1000);
  const params = new URLSearchParams({ token, timeout: String(apifyTimeoutSecs) });
  if (opts.maxItems) params.set("maxItems", String(opts.maxItems));
  // Teto de custo por run. Actors pay-per-event (harvestapi/apify) tem minimo
  // de ~$0.10/run; contas FREE trazem um teto default ABAIXO disso e a API
  // recusa com "max-total-charge-usd-below-minimum". Passar um teto >= minimo
  // destrava (o Apify cobra so o custo real, ate esse teto).
  if (opts.maxTotalChargeUsd) params.set("maxTotalChargeUsd", String(opts.maxTotalChargeUsd));

  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?${params.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(timeoutMs + 15_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApifyError("apify timeout", "timeout");
    }
    throw new ApifyError(`apify falha de rede: ${(err as Error).message}`, "network");
  }

  if (res.status === 401 || res.status === 403) {
    throw new ApifyError("apify token invalido ou sem permissao", "auth", res.status);
  }
  if (res.status === 402) {
    throw new ApifyError("apify sem credito nesta conta", "no_credit", res.status);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApifyError(
      `apify http ${res.status}: ${body.slice(0, 200)}`,
      "upstream",
      res.status,
    );
  }

  const items = (await res.json().catch(() => null)) as T[] | null;
  if (!Array.isArray(items)) {
    throw new ApifyError("apify retorno inesperado (esperava array)", "bad_response");
  }
  return items;
}

// ── LinkedIn ─────────────────────────────────────────────────────────
// Output do actor harvestapi/linkedin-profile-search (campos aninhados).
type RawLinkedIn = {
  publicIdentifier?: string;
  firstName?: string | null;
  lastName?: string | null;
  headline?: string | null;
  linkedinUrl?: string | null;
  location?: { parsed?: { city?: string | null }; linkedinText?: string | null } | null;
  currentPosition?: { companyName?: string | null } | null;
  emails?: Array<{ email?: string | null; status?: string | null }> | null;
  phones?: Array<{ number?: string | null } | string> | null;
};

function firstEmail(emails: RawLinkedIn["emails"]): string | null {
  if (!Array.isArray(emails)) return null;
  for (const e of emails) {
    if (e && typeof e.email === "string" && e.email.includes("@")) return e.email;
  }
  return null;
}

export async function searchLinkedInViaApify(
  organizationId: string,
  opts: { query: string; maxResults: number; location?: string | null },
): Promise<LinkedInProfile[]> {
  const cred = await getOrgCredential(organizationId, "apify");
  const token = cred.apiKey ?? cred.token;
  if (!token) throw new ApifyError("apify sem token/apiKey na credencial", "auth", 401);

  const input: Record<string, unknown> = {
    searchQuery: opts.query,
    profileScraperMode: "Full + email search",
    maxItems: opts.maxResults,
  };
  if (opts.location) input.locations = [opts.location];

  const rows = await runActor<RawLinkedIn>(LINKEDIN_ACTOR, token, input, {
    maxItems: opts.maxResults,
    // ~$0.10 search + $0.01/perfil (Full + email). Teto com folga p/ destravar FREE.
    maxTotalChargeUsd: Math.max(0.5, opts.maxResults * 0.05),
  });

  return rows
    .filter((r) => r.publicIdentifier || r.linkedinUrl)
    .map((r) => {
      const fullName = [r.firstName, r.lastName].filter(Boolean).join(" ").trim() || null;
      const location = r.location?.parsed?.city ?? r.location?.linkedinText ?? null;
      const publicId =
        r.publicIdentifier ??
        r.linkedinUrl?.replace(/\/+$/, "").split("/").pop() ??
        "";
      return {
        publicIdentifier: publicId,
        fullName,
        headline: r.headline ?? null,
        location,
        company: r.currentPosition?.companyName ?? null,
        linkedinUrl: r.linkedinUrl ?? (publicId ? `https://www.linkedin.com/in/${publicId}/` : null),
        email: firstEmail(r.emails),
        phone: null,
      } satisfies LinkedInProfile;
    });
}

// ── Instagram ────────────────────────────────────────────────────────
// Output do actor apify/instagram-scraper (perfis). Campos de contato
// (email/telefone publico) so aparecem em contas business.
type RawInstagram = {
  username?: string | null;
  ownerUsername?: string | null;
  fullName?: string | null;
  biography?: string | null;
  followersCount?: number | null;
  followsCount?: number | null;
  postsCount?: number | null;
  businessCategoryName?: string | null;
  category?: string | null;
  externalUrl?: string | null;
  isBusinessAccount?: boolean | null;
  profilePicUrl?: string | null;
  public_email?: string | null;
  businessEmail?: string | null;
  public_phone_number?: string | null;
  businessPhoneNumber?: string | null;
};

function extractEmailFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0] : null;
}

// Palavras/expressoes tipicas de bio/perfil BR (portugues, atendimento local,
// saude, profissoes). Lista ampla para capturar o maximo de brasileiros.
const _PT_BR_SIGNAIS = [
  "brasil", "brazil", "agende", "agendamento", "atendimento", "consultorio",
  "consultório", "cirurgiao", "cirurgião", "dentista", "advogado", "advogada",
  "corretor", "corretora", "clinica", "clínica", "whatsapp", "orçamento",
  "orcamento", "marcação", "marcacao", "endereço", "endereco", "horário",
  "horario", "atendemos", "agende já", "agende ja", "unidade", "franquia",
  // saude / medico em PT
  "médica", "médico", "saúde", "saude", "paciente", "pacientes", "consulta",
  "consultas", "especialista", "harmonização", "harmonizacao", "estética",
  "estetica", "dermato", "nutricionista", "nutri", "psicóloga", "psicologa",
  "psicólogo", "psicologo", "fisioterapeuta", "odontologia", "odonto",
  "oab", "creci", "voce", "você", "vagas", "reserve", "marque",
  // capitais / cidades BR comuns
  "são paulo", "sao paulo", "rio de janeiro", "belo horizonte", "curitiba",
  "porto alegre", "salvador", "recife", "fortaleza", "brasília", "brasilia",
  "goiânia", "goiania", "manaus", "campinas", "florianópolis", "florianopolis",
  "guarulhos", "santos", "niterói", "niteroi", "uberlândia", "uberlandia",
];

// Estados BR (sigla), casados isolados entre separadores comuns de bio.
const _UF_BR = [
  "sp", "rj", "mg", "rs", "pr", "sc", "ba", "pe", "ce", "go", "df", "es",
  "pa", "am", "mt", "ms", "pb", "rn", "al", "se", "pi", "ma", "to", "ro",
  "ac", "rr", "ap",
];

// CRM medico BR (Conselho Regional de Medicina) e OAB: sinais fortes de BR.
const _CRM_BR_RE = /\b(crm|oab|cro|coren|crefito|crn)[\s\-.:/]/i;
// DDDs BR validos (11 a 99): casa +55 (XX) ou (XX) 9XXXX-XXXX.
const _BR_PHONE_RE = /(?:\+?55\s?)?\(?([1-9][1-9])\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/;
const _WA_LINK_RE = /wa\.me\/55\d{10,11}/i;

/**
 * Decide se um perfil do Instagram "parece Brasil". Usado quando o filtro
 * "apenas Brasil" esta ligado. Procura sinais de portugues/BR no nome e bio:
 * caracteres exclusivos do portugues (c-cedilha, til), palavras PT, CRM/OAB,
 * telefone/wa.me com +55, UF isolada. Se NAO achar nenhum sinal de BR, descarta
 * (antes mantinha neutros, o que deixava passar medicos estrangeiros sem pais
 * explicito). Preferimos perder um BR de bio vazia a receber estrangeiros.
 */
function pareceBrasil(perfil: { fullName: string | null; bio: string | null; phone: string | null }): boolean {
  const texto = `${perfil.fullName ?? ""} ${perfil.bio ?? ""}`.toLowerCase();

  const temSinalBr =
    // c-cedilha e til (ã/õ) nao existem em espanhol nem ingles: bio em portugues.
    /[çãõ]/.test(texto) ||
    _CRM_BR_RE.test(texto) ||
    _PT_BR_SIGNAIS.some((s) => texto.includes(s)) ||
    _WA_LINK_RE.test(texto) ||
    (perfil.phone ? _BR_PHONE_RE.test(perfil.phone) : false) ||
    _BR_PHONE_RE.test(texto) ||
    new RegExp(`(^|[\\s\\-/|•·])(${_UF_BR.join("|")})($|[\\s\\-/|•·])`, "i").test(texto);

  return temSinalBr;
}

export async function searchInstagramViaApify(
  organizationId: string,
  opts: {
    search: string;
    searchType?: "user" | "hashtag";
    maxResults: number;
    // Instagram nao filtra pais nativamente. Quando true (padrao), descarta
    // perfis com sinal claro de outro pais (pareceBrasil). Desligue para minerar
    // outros paises (ex: medico Argentina) usando termos locais na busca.
    onlyBrazil?: boolean;
  },
): Promise<IgLead[]> {
  const cred = await getOrgCredential(organizationId, "apify");
  const token = cred.apiKey ?? cred.token;
  if (!token) throw new ApifyError("apify sem token/apiKey na credencial", "auth", 401);

  const input: Record<string, unknown> = {
    search: opts.search,
    searchType: opts.searchType === "hashtag" ? "hashtag" : "user",
    resultsType: "details",
    searchLimit: opts.maxResults,
    resultsLimit: opts.maxResults,
    addParentData: false,
  };

  const rows = await runActor<RawInstagram>(INSTAGRAM_ACTOR, token, input, {
    maxItems: opts.maxResults,
    // ~$0.0027/perfil. Teto com folga p/ destravar contas FREE (>= $0.10).
    maxTotalChargeUsd: Math.max(0.5, opts.maxResults * 0.02),
  });

  const mapped = rows
    .filter((r) => r.username || r.ownerUsername)
    .map((r) => {
      const username = (r.username ?? r.ownerUsername)!;
      const email =
        r.public_email ??
        r.businessEmail ??
        extractEmailFromText(r.biography) ??
        null;
      const phone = r.public_phone_number ?? r.businessPhoneNumber ?? null;
      return {
        username,
        fullName: r.fullName ?? null,
        bio: r.biography ?? null,
        followers: r.followersCount ?? null,
        following: r.followsCount ?? null,
        postsCount: r.postsCount ?? null,
        category: r.businessCategoryName ?? r.category ?? null,
        externalUrl: r.externalUrl ?? null,
        isBusinessAccount: r.isBusinessAccount ?? null,
        profilePicUrl: r.profilePicUrl ?? null,
        email,
        phone,
        raw: r as unknown as Record<string, unknown>,
      } satisfies IgLead;
    });

  // Filtro de Brasil so quando pedido (padrao true). Desligado no frontend =
  // traz todos os paises (para minerar Argentina, Colombia, etc por termo local).
  if (opts.onlyBrazil === false) return mapped;
  return mapped.filter((lead) => pareceBrasil(lead));
}
