import type { ReactNode } from "react";
import Link from "next/link";
import { requireOrg } from "@/lib/auth/guards";
import { listLeads, type OutreachChannel } from "@/lib/db/queries/leads";
import { listNiches } from "@/lib/db/queries/minings";
import { listActiveOutreachCampaigns } from "@/lib/db/queries/outreach-campaigns";
import { getThreadsForLeads } from "@/lib/db/queries/outreach-status";
import { LeadsRichTable } from "@/components/leads/leads-rich-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

type Status = "all" | "pending" | "qualified" | "disqualified" | "needs_review";

const CANAIS_LABEL: Record<OutreachChannel, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  instagram_dm: "Instagram",
  linkedin_dm: "LinkedIn",
};
const TODOS_CANAIS: OutreachChannel[] = ["whatsapp", "email", "instagram_dm", "linkedin_dm"];

// Chip de filtro compacto (ativo destaca com o acento da marca).
function chipCls(active: boolean): string {
  return `rounded-md border px-2 py-0.5 text-xs transition-colors ${
    active
      ? "border-primary/50 bg-primary/10 font-medium text-primary"
      : "border-input text-muted-foreground hover:bg-accent hover:text-foreground"
  }`;
}

// Grupo de filtro inline: rotulo pequeno + opcoes, tudo na mesma barra (compacto).
// Varios grupos convivem numa unica barra que quebra linha, ocupando bem menos
// espaco vertical que uma linha por filtro.
function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </span>
      {children}
    </div>
  );
}

// Divisoria fina entre grupos de filtro (some quando a barra quebra em varias linhas).
function FilterSep() {
  return <span aria-hidden className="h-4 w-px shrink-0 bg-border" />;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    campaign?: string;
    q?: string;
    nao_abordados?: string;
    responderam?: string;
    has_email?: string;
    has_phone?: string;
    source?: string;
    niche?: string;
    sort?: string;
    dir?: string;
    page?: string;
  }>;
}) {
  const sp = await searchParams;
  const { organizationId } = await requireOrg();

  const SOURCES: Array<{ key: string; label: string }> = [
    { key: "google_places", label: "Google Maps" },
    { key: "linkedin", label: "LinkedIn" },
    { key: "instagram", label: "Instagram" },
    { key: "manual", label: "Manual/CSV" },
  ];
  const source = SOURCES.some((s) => s.key === sp.source) ? sp.source : undefined;
  const niche = sp.niche?.trim() || undefined;
  const sort =
    sp.sort === "name" || sp.sort === "score" || sp.sort === "campaign"
      ? sp.sort
      : undefined;
  const dir = sp.dir === "asc" ? "asc" : "desc";

  const status: Status =
    sp.status === "qualified" ||
    sp.status === "disqualified" ||
    sp.status === "pending" ||
    sp.status === "needs_review"
      ? sp.status
      : "all";

  const naoAbordadosCanal: OutreachChannel | undefined = TODOS_CANAIS.includes(
    sp.nao_abordados as OutreachChannel,
  )
    ? (sp.nao_abordados as OutreachChannel)
    : undefined;

  const responderam = sp.responderam === "1";
  const hasEmail = sp.has_email === "1";
  const hasPhone = sp.has_phone === "1";

  const pageParsed = Number.parseInt(sp.page ?? "", 10);
  const page = Number.isFinite(pageParsed) && pageParsed > 0 ? pageParsed : 1;

  const [{ rows: leads, total }, outreachCampaigns, niches] =
    await Promise.all([
      listLeads({
        organizationId,
        status,
        campaignId: sp.campaign || undefined,
        q: sp.q?.trim() || undefined,
        naoAbordadosCanal,
        source,
        niche,
        sort,
        dir,
        responderam: responderam || undefined,
        hasEmail: hasEmail || undefined,
        hasPhone: hasPhone || undefined,
        limit: PAGE_SIZE,
        page,
      }),
      listActiveOutreachCampaigns(organizationId),
      listNiches(organizationId),
    ]);

  const threads = await getThreadsForLeads(
    organizationId,
    leads.map((l) => l.id),
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function buildHref(opts: {
    status?: string;
    campaign?: string;
    q?: string;
    nao_abordados?: string;
    responderam?: string;
    has_email?: string;
    has_phone?: string;
    source?: string;
    niche?: string;
    sort?: string;
    dir?: string;
    page?: number;
  }) {
    const params = new URLSearchParams();
    if (opts.status && opts.status !== "all") params.set("status", opts.status);
    if (opts.campaign) params.set("campaign", opts.campaign);
    if (opts.q) params.set("q", opts.q);
    if (opts.nao_abordados) params.set("nao_abordados", opts.nao_abordados);
    if (opts.responderam) params.set("responderam", opts.responderam);
    if (opts.has_email) params.set("has_email", opts.has_email);
    if (opts.has_phone) params.set("has_phone", opts.has_phone);
    if (opts.source) params.set("source", opts.source);
    if (opts.niche) params.set("niche", opts.niche);
    if (opts.sort) {
      params.set("sort", opts.sort);
      if (opts.dir === "asc") params.set("dir", "asc");
    }
    if (opts.page && opts.page > 1) params.set("page", String(opts.page));
    const qs = params.toString();
    return qs ? `/leads?${qs}` : "/leads";
  }

  const baseOpts = {
    status: status !== "all" ? status : undefined,
    campaign: sp.campaign,
    q: sp.q?.trim(),
    nao_abordados: naoAbordadosCanal,
    source,
    niche,
    sort,
    dir,
    responderam: responderam ? "1" : undefined,
    has_email: hasEmail ? "1" : undefined,
    has_phone: hasPhone ? "1" : undefined,
  };

  const naoAbordadosHref = (canal: OutreachChannel) => {
    if (naoAbordadosCanal === canal) {
      return buildHref({ ...baseOpts, nao_abordados: undefined });
    }
    return buildHref({ ...baseOpts, nao_abordados: canal, page: undefined });
  };

  const pageHref = (p: number) => buildHref({ ...baseOpts, page: p > 1 ? p : undefined });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            {total} leads{sp.q ? ` para "${sp.q}"` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/leads/import"
            className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Importar CSV
          </Link>
          <a
            href={`/api/leads/export${
              sp.status || sp.campaign
                ? `?${new URLSearchParams({
                    ...(sp.status ? { status: sp.status } : {}),
                    ...(sp.campaign ? { campaign: sp.campaign } : {}),
                  }).toString()}`
                : ""
            }`}
            className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Exportar CSV
          </a>
        </div>
      </div>

      {/* Busca full-text */}
      <form method="GET" action="/leads" className="flex gap-2">
        {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
        {sp.campaign ? <input type="hidden" name="campaign" value={sp.campaign} /> : null}
        {naoAbordadosCanal ? (
          <input type="hidden" name="nao_abordados" value={naoAbordadosCanal} />
        ) : null}
        <Input
          type="search"
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Buscar por nome, email, telefone ou empresa"
          className="max-w-md"
        />
        <Button type="submit" size="sm">
          Buscar
        </Button>
        {sp.q ? (
          <Button
            size="sm"
            variant="ghost"
            render={<Link href={buildHref({ ...baseOpts, q: undefined })}>Limpar</Link>}
          />
        ) : null}
      </form>

      {/* Filtros: barra unica compacta que quebra linha (grupos inline + divisorias) */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-lg border bg-card/40 px-3 py-2">
        <FilterGroup label="Status">
          {(
            [
              ["all", "todos"],
              ["pending", "pendentes"],
              ["qualified", "qualificados"],
              ["disqualified", "rejeitados"],
              ["needs_review", "revisar"],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={buildHref({ ...baseOpts, status: key, page: undefined })}
              className={chipCls(status === key)}
            >
              {label}
            </Link>
          ))}
        </FilterGroup>

        <FilterSep />

        <FilterGroup label="Origem">
          <Link
            href={buildHref({ ...baseOpts, source: undefined, page: undefined })}
            className={chipCls(!source)}
          >
            todas
          </Link>
          {SOURCES.map((s) => (
            <Link
              key={s.key}
              href={buildHref({ ...baseOpts, source: s.key, page: undefined })}
              className={chipCls(source === s.key)}
            >
              {s.label}
            </Link>
          ))}
        </FilterGroup>

        {niches.length > 0 ? (
          <>
            <FilterSep />
            <FilterGroup label="Nicho">
              <Link
                href={buildHref({ ...baseOpts, niche: undefined, page: undefined })}
                className={chipCls(!niche)}
              >
                todos
              </Link>
              {niches.map((n) => (
                <Link
                  key={n}
                  href={buildHref({ ...baseOpts, niche: n, page: undefined })}
                  className={chipCls(niche === n)}
                >
                  {n}
                </Link>
              ))}
            </FilterGroup>
          </>
        ) : null}

        <FilterSep />

        <FilterGroup label="Contato">
          <Link
            href={buildHref({ ...baseOpts, has_email: hasEmail ? undefined : "1", page: undefined })}
            className={chipCls(hasEmail)}
          >
            Tem e-mail
          </Link>
          <Link
            href={buildHref({ ...baseOpts, has_phone: hasPhone ? undefined : "1", page: undefined })}
            className={chipCls(hasPhone)}
          >
            Tem telefone
          </Link>
        </FilterGroup>

        <FilterSep />

        <FilterGroup label="Não abordados">
          {TODOS_CANAIS.map((canal) => (
            <Link
              key={canal}
              href={naoAbordadosHref(canal)}
              className={chipCls(naoAbordadosCanal === canal)}
            >
              {CANAIS_LABEL[canal]}
            </Link>
          ))}
        </FilterGroup>

        <FilterSep />

        <FilterGroup label="Engajamento">
          <Link
            href={buildHref({ ...baseOpts, responderam: responderam ? undefined : "1", page: undefined })}
            className={chipCls(responderam)}
          >
            Responderam
          </Link>
        </FilterGroup>
      </div>

      <LeadsRichTable
        leads={leads.map((l) => ({
          id: l.id,
          displayName: l.displayName,
          handle: l.handle,
          linkedinUrl: l.linkedinUrl,
          email: l.email,
          phone: l.phone,
          website: l.website,
          company: l.company,
          city: l.city,
          source: l.source,
          campaignName: l.campaignName,
          niche: l.niche,
          qualificationStatus: l.qualificationStatus,
          qualificationScore: l.qualificationScore,
          qualificationReason: l.qualificationReason,
          temperature: l.temperature ?? null,
          doNotDisturb: l.doNotDisturb,
        }))}
        outreachCampaigns={outreachCampaigns}
        total={total}
        threads={threads}
        showCampaign
        currentSort={sort}
        currentDir={dir}
        sortHrefs={{
          name: buildHref({ ...baseOpts, sort: "name", dir: sort === "name" && dir === "asc" ? "desc" : "asc", page: undefined }),
          campaign: buildHref({ ...baseOpts, sort: "campaign", dir: sort === "campaign" && dir === "asc" ? "desc" : "asc", page: undefined }),
          score: buildHref({ ...baseOpts, sort: "score", dir: sort === "score" && dir === "asc" ? "desc" : "asc", page: undefined }),
        }}
      />

      {/* Paginacao */}
      {total > PAGE_SIZE ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Página {page} de {totalPages} ({total} leads)
          </p>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Button
                size="sm"
                variant="outline"
                render={<Link href={pageHref(page - 1)}>Anterior</Link>}
              />
            ) : (
              <Button size="sm" variant="outline" disabled>
                Anterior
              </Button>
            )}
            {page < totalPages ? (
              <Button
                size="sm"
                variant="outline"
                render={<Link href={pageHref(page + 1)}>Próximo</Link>}
              />
            ) : (
              <Button size="sm" variant="outline" disabled>
                Próximo
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
