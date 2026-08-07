import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { outreachCampaigns } from "@/db/schema/outreach-campaigns";

export type OutreachCampaignChannel =
  | "email"
  | "whatsapp"
  | "instagram_dm"
  | "linkedin_dm";

export type ActiveOutreachCampaign = {
  id: string;
  name: string;
  channel: OutreachCampaignChannel;
};

// Campanhas de abordagem ativas da org, para o dropdown de disparo nos leads.
export async function listActiveOutreachCampaigns(
  organizationId: string,
): Promise<ActiveOutreachCampaign[]> {
  const rows = await db
    .select({
      id: outreachCampaigns.id,
      name: outreachCampaigns.name,
      channel: outreachCampaigns.channel,
    })
    .from(outreachCampaigns)
    .where(
      and(
        eq(outreachCampaigns.organizationId, organizationId),
        eq(outreachCampaigns.active, true),
      ),
    )
    .orderBy(asc(outreachCampaigns.name));

  return rows;
}
