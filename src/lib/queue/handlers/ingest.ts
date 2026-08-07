import { eq } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { leads as leadsTable } from "@/db/schema/leads";
import { scrapingJobs } from "@/db/schema/jobs";
import { automationConfig } from "@/db/schema/outreach-automation";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type { NormalizedLead, QualifyBatchPayload, ScrapeIngestPayload } from "@/lib/queue/types";

// Blocklist da org (clientes proprios que o dono nao quer prospectar): lista
// de termos (nome/telefone/@) configurada em automation_config.blocklist.
// Sem automation_config para a org, retorna [] e o ingest segue normal.
async function getBlocklistTermos(organizationId: string): Promise<string[]> {
  const [config] = await db
    .select({ blocklist: automationConfig.blocklist })
    .from(automationConfig)
    .where(eq(automationConfig.organizationId, organizationId))
    .limit(1);
  if (!config || !Array.isArray(config.blocklist)) return [];
  return config.blocklist
    .filter((termo): termo is string => typeof termo === "string" && termo.trim().length > 0)
    .map((termo) => termo.trim().toLowerCase());
}

// Casa (case-insensitive, contains) nome/telefone/@ do lead contra os termos
// da blocklist.
function leadBateComBlocklist(lead: NormalizedLead, termosLowercase: string[]): boolean {
  if (termosLowercase.length === 0) return false;
  const campos = [lead.displayName, lead.phone, lead.handle]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map((v) => v.toLowerCase());
  if (campos.length === 0) return false;
  return termosLowercase.some((termo) => campos.some((campo) => campo.includes(termo)));
}

export async function handleScrapeIngest(
  payload: ScrapeIngestPayload,
): Promise<void> {
  const { organizationId, miningId, leads, scrapingJobId } = payload;

  let insertedCount = 0;

  if (leads.length > 0) {
    const blocklistTermos = await getBlocklistTermos(organizationId);

    const leadsToInsert = leads.map((lead) => ({
      organizationId,
      miningId,
      source: lead.source,
      externalId: lead.externalId,
      displayName: lead.displayName,
      handle: lead.handle ?? null,
      website: lead.website ?? null,
      phone: lead.phone ?? null,
      email: lead.email ?? null,
      city: lead.city ?? null,
      region: lead.region ?? null,
      country: lead.country ?? null,
      linkedinUrl: lead.linkedinUrl ?? null,
      headline: lead.headline ?? null,
      company: lead.company ?? null,
      rawData: lead.rawData,
      qualificationStatus: "pending" as const,
      // Cliente proprio detectado na blocklist da org: entra ja bloqueado.
      doNotDisturb: leadBateComBlocklist(lead, blocklistTermos),
    }));

    const inserted = await db
      .insert(leadsTable)
      .values(leadsToInsert)
      .onConflictDoNothing({
        target: [
          leadsTable.organizationId,
          leadsTable.source,
          leadsTable.externalId,
        ],
      })
      .returning({ id: leadsTable.id });

    insertedCount = inserted.length;
  }

  await db
    .update(scrapingJobs)
    .set({ leadsInserted: insertedCount, updatedAt: new Date() })
    .where(eq(scrapingJobs.id, scrapingJobId));

  if (insertedCount > 0) {
    const boss = await getBoss();
    const qualifyPayload: QualifyBatchPayload = {
      organizationId,
      miningId,
    };
    await boss.send(QUEUES.qualifyBatch, qualifyPayload, {
      singletonKey: `qualify:${organizationId}:${miningId}`,
      singletonNextSlot: true,
    });
  }
}
