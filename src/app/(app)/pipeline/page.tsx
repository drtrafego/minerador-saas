import { Users, Send, MessageSquareReply, Percent } from "lucide-react";
import { requireOrg } from "@/lib/auth/guards";
import {
  listPipelineLeads,
  listPipelineStages,
  getPipelineKpis,
} from "@/lib/db/queries/pipeline";
import { getChannelKpis, type ChannelKpi } from "@/lib/db/queries/outreach-status";
import { KanbanBoard } from "@/components/pipeline/kanban-board";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const CHANNEL_LABELS: Record<ChannelKpi["channel"], string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  instagram_dm: "Instagram",
  linkedin_dm: "LinkedIn",
};

export default async function PipelinePage() {
  const { organizationId } = await requireOrg();
  const [stages, leads, kpis, channelKpis] = await Promise.all([
    listPipelineStages(organizationId),
    listPipelineLeads(organizationId),
    getPipelineKpis(organizationId),
    getChannelKpis(organizationId),
  ]);

  const cards = [
    { label: "Leads no funil", value: kpis.total.toLocaleString("pt-BR"), icon: Users, tone: "text-muted-foreground", bg: "bg-muted" },
    { label: "Abordados", value: kpis.abordados.toLocaleString("pt-BR"), icon: Send, tone: "text-info", bg: "bg-info/10" },
    { label: "Respostas", value: kpis.respostas.toLocaleString("pt-BR"), icon: MessageSquareReply, tone: "text-success", bg: "bg-success/10" },
    { label: "Taxa de resposta", value: `${kpis.taxaResposta}%`, icon: Percent, tone: "text-primary", bg: "bg-primary/10" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Arraste leads qualificados pelas etapas do seu funil.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="gap-2 py-4">
              <CardContent className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{kpi.label}</p>
                  <p className="text-2xl font-bold tabular-nums">{kpi.value}</p>
                </div>
                <div className={`flex size-10 items-center justify-center rounded-lg ${kpi.bg}`}>
                  <Icon className={`size-5 ${kpi.tone}`} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Breakdown por canal */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {channelKpis.map((ck) => (
          <Card key={ck.channel} className="py-3">
            <CardContent className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase">
                {CHANNEL_LABELS[ck.channel]}
              </p>
              <div className="flex items-end justify-between gap-1">
                <div>
                  <p className="text-lg font-bold tabular-nums">{ck.abordados}</p>
                  <p className="text-xs text-muted-foreground">abordados</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold tabular-nums text-success">{ck.respostas}</p>
                  <p className="text-xs text-muted-foreground">respostas</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">faltam</span>
                <Badge variant={ck.faltam > 0 ? "secondary" : "outline"} className="text-xs">
                  {ck.faltam}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <KanbanBoard stages={stages} leads={leads} />
    </div>
  );
}
