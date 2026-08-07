import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Globe, Mail, MapPin, Phone, Link as LinkIcon } from "lucide-react";
import { requireOrg } from "@/lib/auth/guards";
import { getLead } from "@/lib/db/queries/leads";
import { listLeadActivities, listPipelineStages } from "@/lib/db/queries/pipeline";
import { getChannelOutreachStatus, type ChannelStatus } from "@/lib/db/queries/outreach-status";
import { ActivityTimeline } from "@/components/pipeline/activity-timeline";
import { TemperatureBadge } from "@/components/temperature-badge";
import { Badge } from "@/components/ui/badge";
import { formatPhoneBR } from "@/lib/format-phone";
import { LeadStageSelect } from "./stage-select";

const CHANNEL_LABELS: Record<ChannelStatus["channel"], string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  instagram_dm: "Instagram",
  linkedin_dm: "LinkedIn",
};

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireOrg();

  const [lead, activities, stages, channelStatus] = await Promise.all([
    getLead({ organizationId, leadId: id }),
    listLeadActivities(id, organizationId),
    listPipelineStages(organizationId),
    getChannelOutreachStatus(organizationId, id),
  ]);

  if (!lead) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/leads"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          voltar
        </Link>
        <div className="flex items-center gap-2">
          <TemperatureBadge
            temperature={lead.temperature}
            score={lead.qualificationScore}
          />
          <Badge variant="outline">{lead.qualificationStatus}</Badge>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="md:col-span-2 space-y-6">
          <div className="rounded-xl border p-5">
            <h1 className="text-xl font-semibold">{lead.displayName}</h1>
            {lead.headline || lead.company ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {[lead.headline, lead.company].filter(Boolean).join(" - ")}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-3 text-sm text-muted-foreground">
              {lead.email ? (
                <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <Mail className="h-4 w-4" />
                  {lead.email}
                </a>
              ) : null}
              {(() => {
                if (!lead.phone) return null;
                const tel = formatPhoneBR(lead.phone);
                if (tel) {
                  return (
                    <a
                      href={tel.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-success hover:text-success/80"
                    >
                      <Phone className="h-4 w-4" />
                      {tel.display}
                    </a>
                  );
                }
                return (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-4 w-4" />
                    {lead.phone}
                  </span>
                );
              })()}
              {lead.website ? (
                <a href={lead.website} target="_blank" rel="noopener" className="inline-flex items-center gap-1 hover:text-foreground">
                  <Globe className="h-4 w-4" />
                  {lead.website.replace(/^https?:\/\//, "")}
                </a>
              ) : null}
              {lead.linkedinUrl ? (
                <a href={lead.linkedinUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 hover:text-foreground">
                  <LinkIcon className="h-4 w-4" />
                  linkedin
                </a>
              ) : null}
              {lead.city || lead.region ? (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {[lead.city, lead.region, lead.country].filter(Boolean).join(", ")}
                </span>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl border p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
              Atividades
            </h2>
            <ActivityTimeline leadId={lead.id} activities={activities} />
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border p-4">
            <p className="text-xs uppercase text-muted-foreground">Etapa</p>
            <div className="mt-2">
              <LeadStageSelect
                leadId={lead.id}
                currentStageId={lead.pipelineStageId ?? null}
                stages={stages}
              />
            </div>
          </div>

          <div className="rounded-xl border p-4">
            <p className="text-xs uppercase text-muted-foreground mb-3">Abordagem por canal</p>
            <div className="space-y-2">
              {channelStatus.map((cs) => (
                <div key={cs.channel} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{CHANNEL_LABELS[cs.channel]}</span>
                  {cs.abordado ? (
                    <Badge variant={cs.respondido ? "default" : "secondary"} className="text-xs">
                      {cs.respondido ? "respondeu" : "abordado"}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      falta
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs uppercase text-muted-foreground">Fonte</p>
            <p className="mt-1 text-sm">{lead.source}</p>
            {lead.handle ? (
              <p className="text-xs text-muted-foreground">@{lead.handle}</p>
            ) : null}
            {lead.campaignName ? (
              <p className="mt-2 text-xs text-muted-foreground">
                campanha: {lead.campaignName}
              </p>
            ) : null}
          </div>
          {lead.qualificationReason ? (
            <div className="rounded-xl border p-4">
              <p className="text-xs uppercase text-muted-foreground">Justificativa</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {lead.qualificationReason}
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
