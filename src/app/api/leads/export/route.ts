import { NextRequest } from "next/server";
import { requireOrg } from "@/lib/auth/guards";
import { listLeads } from "@/lib/db/queries/leads";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

const HEADERS = [
  "id",
  "displayName",
  "handle",
  "email",
  "phone",
  "website",
  "city",
  "region",
  "country",
  "company",
  "headline",
  "linkedinUrl",
  "source",
  "qualificationStatus",
  "qualificationScore",
  "temperature",
  "campaignName",
  "createdAt",
];

export async function GET(req: NextRequest) {
  const { organizationId } = await requireOrg();
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "all";
  const campaign = url.searchParams.get("campaign") ?? undefined;

  const normalized =
    status === "qualified" ||
    status === "disqualified" ||
    status === "pending" ||
    status === "needs_review"
      ? status
      : "all";

  const { rows } = await listLeads({
    organizationId,
    status: normalized,
    campaignId: campaign,
    limit: 10000,
  });

  const serialized = rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    handle: r.handle ?? "",
    email: r.email ?? "",
    phone: r.phone ?? "",
    website: r.website ?? "",
    city: r.city ?? "",
    region: r.region ?? "",
    country: r.country ?? "",
    company: r.company ?? "",
    headline: r.headline ?? "",
    linkedinUrl: r.linkedinUrl ?? "",
    source: r.source,
    qualificationStatus: r.qualificationStatus,
    qualificationScore: r.qualificationScore ?? "",
    temperature: r.temperature ?? "",
    campaignName: r.campaignName ?? "",
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
  }));

  const csv = toCsv(HEADERS, serialized);
  const filename = `leads-${new Date().toISOString().split("T")[0]}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
