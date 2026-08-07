import { Users, BadgeCheck, Send, MessageSquareReply, CalendarCheck } from "lucide-react";
import { requireOrg } from "@/lib/auth/guards";
import {
  getActiveCampaigns,
  getFunnelMetrics,
  getMessagesStats,
  getSendsPerDay,
  getThreadsByStatus,
} from "@/lib/dashboard/queries";
import { StatCard } from "@/components/dashboard/stat-card";
import { FunnelChart } from "@/components/dashboard/funnel-chart";
import { StatusBreakdown } from "@/components/dashboard/status-breakdown";
import { SendsPerDay } from "@/components/dashboard/sends-per-day";
import { ActiveCampaigns } from "@/components/dashboard/active-campaigns";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, organizationId } = await requireOrg();

  const [funnel, threadsByStatus, messages, sends, activeCampaigns] =
    await Promise.all([
      getFunnelMetrics({ organizationId }),
      getThreadsByStatus({ organizationId }),
      getMessagesStats({ organizationId }),
      getSendsPerDay({ organizationId }),
      getActiveCampaigns({ organizationId }),
    ]);

  const funnelData = [
    { label: "Leads capturados", value: funnel.leadsTotal },
    { label: "Qualificados", value: funnel.leadsQualified },
    { label: "Contatados", value: funnel.leadsContacted },
    { label: "Responderam", value: funnel.leadsReplied },
    { label: "Agendaram", value: funnel.leadsBooked },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Olá, {user.name}. Últimos 30 dias.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Leads" value={funnel.leadsTotal} icon={Users} />
        <StatCard label="Qualificados" value={funnel.leadsQualified} icon={BadgeCheck} />
        <StatCard label="Contatados" value={funnel.leadsContacted} icon={Send} />
        <StatCard
          label="Respostas"
          value={funnel.leadsReplied}
          subtitle={`${messages.sent} enviadas, ${messages.failed} falhas`}
          icon={MessageSquareReply}
          accent
        />
        <StatCard label="Agendaram" value={funnel.leadsBooked} icon={CalendarCheck} />
      </div>

      <FunnelChart data={funnelData} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StatusBreakdown items={threadsByStatus} />
        <SendsPerDay data={sends} />
      </div>

      <ActiveCampaigns items={activeCampaigns} />
    </div>
  );
}
