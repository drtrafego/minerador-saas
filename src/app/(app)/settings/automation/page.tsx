import { eq } from "drizzle-orm";
import { requireOrg } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { automationConfig } from "@/db/schema/outreach-automation";
import { outreachCampaigns } from "@/db/schema/outreach-campaigns";
import { getChannelWarmup, restanteCanal } from "@/lib/outreach/warmup";
import { AutomationForm } from "./form";

export const dynamic = "force-dynamic";

function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function AutomationSettingsPage() {
  const { organizationId } = await requireOrg();

  const [config] = await db
    .select()
    .from(automationConfig)
    .where(eq(automationConfig.organizationId, organizationId))
    .limit(1);

  const campaigns = await db
    .select({
      id: outreachCampaigns.id,
      name: outreachCampaigns.name,
      channel: outreachCampaigns.channel,
    })
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.organizationId, organizationId));

  const [
    warmupWhatsapp,
    warmupEmail,
    restanteWhatsapp,
    restanteEmail,
  ] = await Promise.all([
    getChannelWarmup(organizationId, "whatsapp"),
    getChannelWarmup(organizationId, "email"),
    restanteCanal(organizationId, "whatsapp"),
    restanteCanal(organizationId, "email"),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Automação de prospecção</h1>
        <p className="text-sm text-muted-foreground">
          Configure a mineração diária, o aquecimento de envio por canal e como
          o disparo do dia é liberado.
        </p>
      </div>

      <AutomationForm
        initial={{
          miningEnabled: Boolean(config?.miningEnabled),
          rotationCombos: (config?.rotationCombos ?? []).map((c) => ({
            niche: c.niche,
            city: c.city ?? "",
            sourceType: (c.sourceType === "instagram_hashtag" ||
            c.sourceType === "linkedin_search"
              ? c.sourceType
              : "google_places") as
              | "google_places"
              | "instagram_hashtag"
              | "linkedin_search",
          })),
          nicheRouting: (config?.nicheRouting ?? []).map((r) => ({
            niche: r.niche,
            channel: r.channel,
            campaignId: r.campaignId,
          })),
          dispatchMode: config?.dispatchMode ?? "approval",
          whatsappCampaignId: config?.whatsappCampaignId ?? "",
          emailCampaignId: config?.emailCampaignId ?? "",
          blocklist: config?.blocklist ?? [],
        }}
        warmup={{
          whatsapp: {
            enabled: warmupWhatsapp?.enabled ?? false,
            startedAt: warmupWhatsapp?.startedAt ?? hojeIso(),
            restante: restanteWhatsapp,
          },
          email: {
            enabled: warmupEmail?.enabled ?? false,
            startedAt: warmupEmail?.startedAt ?? hojeIso(),
            restante: restanteEmail,
          },
        }}
        campaigns={{
          whatsapp: campaigns.filter((c) => c.channel === "whatsapp"),
          email: campaigns.filter((c) => c.channel === "email"),
        }}
      />
    </div>
  );
}
