"use client";

import { useMemo, useState, useCallback, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { setLeadsDoNotDisturb } from "@/app/(app)/leads/dnd-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TemperatureBadge } from "@/components/temperature-badge";
import { OutreachBadge, resolveOutreachState } from "@/components/leads/outreach-badge";
import { DispararDialog } from "@/components/leads/outreach-dialog";
import { formatPhoneBR } from "@/lib/format-phone";

export type CampaignOption = { id: string; name: string };

export type OutreachCampaignOption = {
  id: string;
  name: string;
  channel: "email" | "whatsapp" | "instagram_dm" | "linkedin_dm";
};

export type ThreadInfo = {
  leadId: string;
  channel: string;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  status: string;
};

export type LeadRichRow = {
  id: string;
  displayName: string;
  handle: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  company: string | null;
  city: string | null;
  source: string;
  campaignName: string | null;
  niche: string | null;
  qualificationStatus: string;
  qualificationScore: number | null;
  qualificationReason: string | null;
  temperature: "cold" | "warm" | "hot" | null;
  doNotDisturb: boolean;
};

const STATUS_LABEL: Record<string, string> = {
  qualified: "qualificado",
  disqualified: "rejeitado",
  pending: "pendente",
  queued: "fila",
  needs_review: "revisar",
};

const STATUS_VARIANT: Record<string, "default" | "outline" | "destructive" | "secondary"> = {
  qualified: "default",
  disqualified: "destructive",
  pending: "secondary",
  queued: "secondary",
  needs_review: "outline",
};

const QTD_ATALHOS = [25, 50, 100];

export function LeadsRichTable({
  leads,
  outreachCampaigns,
  total,
  threads,
  showCampaign,
  sortHrefs,
  currentSort,
  currentDir,
}: {
  leads: LeadRichRow[];
  outreachCampaigns: OutreachCampaignOption[];
  total: number;
  threads: ThreadInfo[];
  showCampaign?: boolean;
  sortHrefs?: { name: string; campaign: string; score: string };
  currentSort?: "name" | "campaign" | "score";
  currentDir?: "asc" | "desc";
}) {
  // Cabecalho clicavel: link para ordenar + seta da direcao atual.
  function SortHead({ col, label, href, align }: { col: "name" | "campaign" | "score"; label: string; href?: string; align?: "right" }) {
    if (!href) return <>{label}</>;
    const active = currentSort === col;
    const arrow = active ? (currentDir === "asc" ? " ↑" : " ↓") : "";
    return (
      <Link
        href={href}
        className={`inline-flex items-center hover:underline ${active ? "font-semibold text-foreground" : ""} ${align === "right" ? "justify-end" : ""}`}
      >
        {label}
        {arrow}
      </Link>
    );
  }
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [bloqueando, startBloquear] = useTransition();

  function handleBloquear() {
    const ids = [...selecionados];
    if (ids.length === 0) return;
    startBloquear(async () => {
      const r = await setLeadsDoNotDisturb(ids, true);
      if (r && "error" in r) {
        toast.error(r.error);
        return;
      }
      toast.success(
        `${ids.length} lead(s) bloqueado(s): nao serao mais abordados.`,
      );
      setSelecionados(new Set());
    });
  }
  const [qtdInput, setQtdInput] = useState("");
  const [dispararOpen, setDispararOpen] = useState(false);
  const [campanhaBarraId, setCampanhaBarraId] = useState(
    outreachCampaigns[0]?.id ?? "",
  );

  // Limpa seleção quando os leads mudam (novo filtro/página).
  const rowKey = useMemo(() => leads.map((l) => l.id).join(","), [leads]);
  const [prevRowKey, setPrevRowKey] = useState(rowKey);
  if (rowKey !== prevRowKey) {
    setPrevRowKey(rowKey);
    setSelecionados(new Set());
  }

  // Threads agrupadas por leadId: canal primário de cada lead
  const threadByLead = useMemo(() => {
    const map = new Map<string, ThreadInfo>();
    for (const t of threads) {
      const current = map.get(t.leadId);
      if (!current) {
        map.set(t.leadId, t);
        continue;
      }
      const hasInbound = t.lastInboundAt != null;
      const hasOutbound = t.lastOutboundAt != null;
      const curInbound = current.lastInboundAt != null;
      const curOutbound = current.lastOutboundAt != null;
      if (hasInbound && !curInbound) map.set(t.leadId, t);
      else if (hasOutbound && !curOutbound && !curInbound) map.set(t.leadId, t);
    }
    return map;
  }, [threads]);

  const idsPagina = useMemo(() => leads.map((l) => l.id), [leads]);
  const todosPaginaMarcados =
    idsPagina.length > 0 && idsPagina.every((id) => selecionados.has(id));

  function toggleLead(id: string) {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTodosPagina() {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (todosPaginaMarcados) idsPagina.forEach((id) => next.delete(id));
      else idsPagina.forEach((id) => next.add(id));
      return next;
    });
  }

  // Pre-seleciona os primeiros N leads do resultado atual (página carregada).
  function selecionarQuantidade(n: number) {
    if (!Number.isFinite(n) || n <= 0) return;
    setSelecionados(new Set(idsPagina.slice(0, Math.min(n, idsPagina.length))));
  }

  const handleDispararSuccess = useCallback(() => {
    setSelecionados(new Set());
  }, []);

  const qtdSelecionada = selecionados.size;
  const temSelecao = qtdSelecionada > 0;

  if (leads.length === 0) {
    return (
      <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
        Nenhum lead encontrado com esses filtros.
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {/* Pré-seleção por quantidade */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Selecionar rápido:</span>
          {QTD_ATALHOS.map((n) => (
            <Button
              key={n}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => selecionarQuantidade(n)}
            >
              {n}
            </Button>
          ))}
          <Input
            type="number"
            min={1}
            value={qtdInput}
            onChange={(e) => setQtdInput(e.target.value)}
            placeholder="qtd"
            className="h-9 w-20"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => selecionarQuantidade(Number(qtdInput))}
          >
            Selecionar
          </Button>
        </div>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Marcar todos da página"
                    checked={todosPaginaMarcados}
                    onChange={toggleTodosPagina}
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                </TableHead>
                <TableHead><SortHead col="name" label="Nome" href={sortHrefs?.name} /></TableHead>
                {showCampaign ? <TableHead>Nicho</TableHead> : null}
                <TableHead>Fonte</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Cidade</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right"><SortHead col="score" label="Score" href={sortHrefs?.score} align="right" /></TableHead>
                <TableHead>Outreach</TableHead>
                <TableHead>Motivo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((lead) => {
                const thread = threadByLead.get(lead.id) ?? null;
                const outreachState = resolveOutreachState({
                  doNotDisturb: lead.doNotDisturb,
                  lastOutboundAt: thread?.lastOutboundAt ?? null,
                  lastInboundAt: thread?.lastInboundAt ?? null,
                  threadStatus: thread?.status ?? null,
                });
                const marcado = selecionados.has(lead.id);

                // Destaque visual para leads com atividade inbound
                const rowHighlight =
                  outreachState === "nova_mensagem"
                    ? "bg-warning/[0.07]"
                    : outreachState === "respondeu"
                      ? "bg-success/[0.06]"
                      : "";

                return (
                  <TableRow
                    key={lead.id}
                    className={`border-b border-border ${marcado ? "bg-muted/30" : rowHighlight}`}
                  >
                    <TableCell className="w-10">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${lead.displayName}`}
                        checked={marcado}
                        onChange={() => toggleLead(lead.id)}
                        className="h-4 w-4 cursor-pointer accent-primary"
                      />
                    </TableCell>
                    <TableCell className="max-w-[16rem] overflow-hidden align-top whitespace-normal">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="truncate font-medium hover:underline"
                        >
                          {lead.displayName}
                        </Link>
                        <TemperatureBadge
                          temperature={lead.temperature ?? null}
                          score={lead.qualificationScore}
                          compact
                        />
                      </div>
                      {lead.handle
                        ? (() => {
                            const h = lead.handle.replace(/^@/, "");
                            const url =
                              lead.source === "linkedin"
                                ? lead.linkedinUrl || `https://www.linkedin.com/in/${h}`
                                : lead.source === "instagram"
                                  ? `https://instagram.com/${h}`
                                  : null;
                            return url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate text-xs text-primary hover:underline"
                              >
                                @{h}
                              </a>
                            ) : (
                              <div className="truncate text-xs text-muted-foreground">@{h}</div>
                            );
                          })()
                        : null}
                      {lead.company && lead.company !== lead.displayName ? (
                        <div className="truncate text-xs text-muted-foreground">{lead.company}</div>
                      ) : null}
                    </TableCell>
                    {showCampaign ? (
                      <TableCell className="text-xs">
                        {lead.niche ? (
                          <Badge variant="outline" className="font-normal capitalize">
                            {lead.niche}
                          </Badge>
                        ) : (
                          "-"
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-xs">{lead.source}</TableCell>
                    {/* Telefone */}
                    <TableCell className="text-xs">
                      {(() => {
                        const tel = formatPhoneBR(lead.phone);
                        if (tel) {
                          return (
                            <a
                              href={tel.href}
                              target="_blank"
                              rel="noreferrer"
                              className="text-success hover:underline"
                            >
                              {tel.display}
                            </a>
                          );
                        }
                        return lead.phone ? lead.phone : <span className="text-muted-foreground">-</span>;
                      })()}
                    </TableCell>
                    {/* E-mail */}
                    <TableCell className="max-w-[13rem] overflow-hidden text-xs">
                      {lead.email ? (
                        <a
                          href={`mailto:${lead.email}`}
                          className="truncate hover:underline"
                          title={lead.email}
                        >
                          {lead.email}
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    {/* Site */}
                    <TableCell className="text-xs">
                      {lead.website ? (
                        <a
                          href={lead.website}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          site
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{lead.city ?? "-"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[lead.qualificationStatus] ?? "outline"}>
                        {STATUS_LABEL[lead.qualificationStatus] ?? lead.qualificationStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {lead.qualificationScore ?? "-"}
                    </TableCell>
                    <TableCell>
                      <OutreachBadge state={outreachState} />
                    </TableCell>
                    <TableCell className="max-w-[18rem] overflow-hidden align-top whitespace-normal">
                      {lead.qualificationReason ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <span className="block max-w-xs cursor-help truncate text-xs text-muted-foreground">
                                {lead.qualificationReason}
                              </span>
                            }
                          />
                          <TooltipContent className="max-w-sm">
                            {lead.qualificationReason}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {total > idsPagina.length ? (
          <p className="text-xs text-muted-foreground">
            Mostrando {idsPagina.length} de {total} leads. A seleção rápida marca
            apenas leads desta página.
          </p>
        ) : null}

        {/* Sticky bar de seleção em lote */}
        {temSelecao ? (
          <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-3 shadow-lg">
            <div className="text-sm">
              <span className="font-semibold">{qtdSelecionada}</span>{" "}
              {qtdSelecionada === 1 ? "lead selecionado" : "leads selecionados"}
            </div>
            <div className="flex items-center gap-2">
              {outreachCampaigns.length > 0 ? (
                <select
                  value={campanhaBarraId}
                  onChange={(e) => setCampanhaBarraId(e.target.value)}
                  aria-label="Campanha de abordagem"
                  className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  {outreachCampaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <Button
                size="sm"
                onClick={() => setDispararOpen(true)}
                type="button"
              >
                Disparar
              </Button>
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={handleBloquear}
                disabled={bloqueando}
                title="Marca como nao perturbe: nunca serao abordados (para bloquear clientes proprios)"
              >
                {bloqueando ? "Bloqueando..." : "Bloquear"}
              </Button>
              <button
                type="button"
                onClick={() => setSelecionados(new Set())}
                className="text-sm text-muted-foreground hover:underline"
              >
                Limpar
              </button>
            </div>
          </div>
        ) : null}

        {/* Diálogo de configuração do disparo */}
        <DispararDialog
          open={dispararOpen}
          onOpenChange={setDispararOpen}
          leadIds={[...selecionados]}
          outreachCampaigns={outreachCampaigns}
          initialCampaignId={campanhaBarraId}
          onSuccess={handleDispararSuccess}
        />
      </div>
    </TooltipProvider>
  );
}
