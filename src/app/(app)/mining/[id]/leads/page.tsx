import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth/guards";
import { getMiningById } from "@/lib/db/queries/minings";
import { listLeads } from "@/lib/db/queries/leads";
import { getOutreachStatusByLead } from "@/lib/db/queries/inbox";
import { LeadsTable } from "@/components/leads-table";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type Status = "all" | "pending" | "qualified" | "disqualified" | "needs_review";

export default async function CampaignLeadsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { id } = await params;
  const { status: statusParam } = await searchParams;
  const { organizationId } = await requireOrg();

  const campaign = await getMiningById(organizationId, id);
  if (!campaign) notFound();

  const status: Status =
    statusParam === "qualified" ||
    statusParam === "disqualified" ||
    statusParam === "pending" ||
    statusParam === "needs_review"
      ? statusParam
      : "all";

  const { rows: leads } = await listLeads({
    organizationId,
    campaignId: id,
    status,
  });

  const outreachMap = await getOutreachStatusByLead(
    organizationId,
    leads.map((l) => l.id),
  );
  const outreachByLead: Record<string, { threadId: string; status: string }> = {};
  for (const [leadId, v] of outreachMap.entries()) {
    outreachByLead[leadId] = { threadId: v.id, status: v.status };
  }

  const baseHref = `/mining/${id}/leads`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">
            Mineração: {campaign.name}
          </p>
        </div>
        <Button
          variant="outline"
          render={<Link href={`/mining/${id}`}>Voltar</Link>}
        />
      </div>

      <div className="flex flex-wrap gap-2">
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
            href={key === "all" ? baseHref : `${baseHref}?status=${key}`}
            className={`rounded-lg border px-3 py-1 text-sm ${
              status === key
                ? "border-ring bg-secondary"
                : "border-input text-muted-foreground"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      <LeadsTable
        leads={leads}
        campaignId={id}
        outreachByLead={outreachByLead}
      />
    </div>
  );
}
