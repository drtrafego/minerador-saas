import { notFound } from "next/navigation";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { outreachCampaigns } from "@/db/schema/outreach-campaigns";
import { Button } from "@/components/ui/button";
import { EditOutreachForm } from "./edit-form";
import { listApprovedMetaTemplates } from "../actions";
import { parseTemplateVars } from "@/lib/utils/template-vars";

export const dynamic = "force-dynamic";

export default async function OutreachDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireOrg();

  const rows = await db
    .select()
    .from(outreachCampaigns)
    .where(
      and(
        eq(outreachCampaigns.id, id),
        eq(outreachCampaigns.organizationId, organizationId),
      ),
    )
    .limit(1);

  const campaign = rows[0];
  if (!campaign) notFound();

  const touches = (Array.isArray(campaign.sequenceJson)
    ? campaign.sequenceJson
    : []
  ).map((t) => ({
    delayDays: Number(t.delayDays) || 0,
    subject: t.subject ?? "",
    body: t.body ?? "",
  }));

  const {
    available: templatesAvailable,
    error: templatesError,
    templates,
  } = await listApprovedMetaTemplates();

  const metaTemplate = campaign.metaTemplateName
    ? {
        name: campaign.metaTemplateName,
        lang: campaign.metaTemplateLang ?? "pt_BR",
        vars: parseTemplateVars(campaign.metaTemplateVars),
        body: campaign.metaTemplateBody ?? "",
      }
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <p className="text-sm text-muted-foreground">
            Editar campanha de abordagem.
          </p>
        </div>
        <Button
          variant="outline"
          render={<Link href="/outreach">Voltar</Link>}
        />
      </div>

      <EditOutreachForm
        initial={{
          id: campaign.id,
          name: campaign.name,
          channel: campaign.channel,
          active: campaign.active,
          sendPaused: campaign.sendPaused,
          dailyCap: campaign.dailyCap,
          touches,
          metaTemplate,
        }}
        templates={templates}
        templatesAvailable={templatesAvailable}
        templatesError={templatesError}
      />
    </div>
  );
}
