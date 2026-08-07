"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  approveLead,
  rejectLead,
} from "@/app/(app)/mining/[id]/leads/actions";
import { TemperatureBadge } from "@/components/temperature-badge";

type Lead = {
  id: string;
  miningId: string | null;
  campaignName?: string | null;
  source: string;
  displayName: string;
  handle: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  qualificationStatus: string;
  qualificationScore: number | null;
  qualificationReason: string | null;
  temperature?: "cold" | "warm" | "hot" | null;
};

type OutreachStatus = {
  threadId: string;
  status: string;
};

const OUTREACH_STATUS_LABEL: Record<string, string> = {
  queued: "fila",
  active: "ativo",
  awaiting_reply: "aguardando",
  replied: "respondeu",
  booked: "reservado",
  dead: "encerrado",
  finished: "concluído",
  failed: "falhou",
};

const OUTREACH_STATUS_VARIANT: Record<
  string,
  "default" | "outline" | "destructive" | "secondary"
> = {
  queued: "secondary",
  active: "default",
  awaiting_reply: "outline",
  replied: "default",
  booked: "default",
  finished: "outline",
  failed: "destructive",
  dead: "outline",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "outline" | "destructive" | "secondary"
> = {
  qualified: "default",
  disqualified: "destructive",
  pending: "secondary",
  queued: "secondary",
  needs_review: "outline",
};

const STATUS_LABEL: Record<string, string> = {
  qualified: "qualificado",
  disqualified: "rejeitado",
  pending: "pendente",
  queued: "fila",
  needs_review: "revisar",
};

export function LeadsTable({
  leads,
  campaignId,
  showCampaign,
  outreachByLead,
}: {
  leads: Lead[];
  campaignId?: string;
  showCampaign?: boolean;
  outreachByLead?: Record<string, OutreachStatus>;
}) {
  const [pending, start] = useTransition();

  function approve(lead: Lead) {
    const cid = campaignId ?? lead.miningId ?? "";
    if (!cid) {
      toast.error("lead sem campanha");
      return;
    }
    start(async () => {
      const r = await approveLead(lead.id, cid);
      if ("ok" in r && r.ok) toast.success("aprovado");
      else toast.error("falha ao aprovar");
    });
  }

  function reject(lead: Lead) {
    const cid = campaignId ?? lead.miningId ?? "";
    if (!cid) {
      toast.error("lead sem campanha");
      return;
    }
    start(async () => {
      const r = await rejectLead(lead.id, cid);
      if ("ok" in r && r.ok) toast.success("rejeitado");
      else toast.error("falha ao rejeitar");
    });
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
        Nenhum lead encontrado
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              {showCampaign ? <TableHead>Mineração</TableHead> : null}
              <TableHead>Fonte</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>Cidade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Score</TableHead>
              {outreachByLead ? <TableHead>Outreach</TableHead> : null}
              <TableHead>Motivo</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell className="max-w-xs">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-medium hover:underline"
                    >
                      {lead.displayName}
                    </Link>
                    <TemperatureBadge
                      temperature={lead.temperature ?? null}
                      score={lead.qualificationScore}
                      compact
                    />
                  </div>
                  {lead.handle ? (
                    <div className="text-xs text-muted-foreground">
                      @{lead.handle}
                    </div>
                  ) : null}
                </TableCell>
                {showCampaign ? (
                  <TableCell className="text-xs">
                    {lead.campaignName ?? "-"}
                  </TableCell>
                ) : null}
                <TableCell className="text-xs">{lead.source}</TableCell>
                <TableCell className="text-xs">
                  {lead.phone ? <div>{lead.phone}</div> : null}
                  {lead.email ? <div>{lead.email}</div> : null}
                  {lead.website ? (
                    <a
                      href={lead.website}
                      target="_blank"
                      rel="noreferrer"
                      className="text-info hover:underline"
                    >
                      site
                    </a>
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">{lead.city ?? "-"}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      STATUS_VARIANT[lead.qualificationStatus] ?? "outline"
                    }
                  >
                    {STATUS_LABEL[lead.qualificationStatus] ??
                      lead.qualificationStatus}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {lead.qualificationScore ?? "-"}
                </TableCell>
                {outreachByLead ? (
                  <TableCell>
                    {outreachByLead[lead.id] ? (
                      <Link
                        href={`/inbox/${outreachByLead[lead.id]!.threadId}`}
                      >
                        <Badge
                          variant={
                            OUTREACH_STATUS_VARIANT[
                              outreachByLead[lead.id]!.status
                            ] ?? "outline"
                          }
                        >
                          {OUTREACH_STATUS_LABEL[
                            outreachByLead[lead.id]!.status
                          ] ?? outreachByLead[lead.id]!.status}
                        </Badge>
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        sem thread
                      </span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell className="max-w-xs">
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
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => approve(lead)}
                    >
                      Aprovar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => reject(lead)}
                    >
                      Rejeitar
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}
