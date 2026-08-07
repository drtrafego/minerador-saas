import { and, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import {
  dailySendPlan,
  dailySendPlanItem,
} from "@/db/schema/outreach-automation";
import { leads } from "@/db/schema/leads";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanActions } from "./actions-buttons";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  instagram_dm: "Instagram",
  linkedin_dm: "LinkedIn",
};

function hojeIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function OutreachPlanPage() {
  const { organizationId } = await requireOrg();
  const hoje = hojeIso();

  const plans = await db
    .select()
    .from(dailySendPlan)
    .where(
      and(
        eq(dailySendPlan.organizationId, organizationId),
        eq(dailySendPlan.planDate, hoje),
        eq(dailySendPlan.status, "pending"),
      ),
    );

  const samples = await Promise.all(
    plans.map((p) =>
      db
        .select({
          leadId: dailySendPlanItem.leadId,
          displayName: leads.displayName,
          phone: leads.phone,
          email: leads.email,
        })
        .from(dailySendPlanItem)
        .innerJoin(leads, eq(leads.id, dailySendPlanItem.leadId))
        .where(eq(dailySendPlanItem.planId, p.id))
        .limit(10),
    ),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Plano de disparo do dia</h1>
        <p className="text-sm text-muted-foreground">
          Revise e aprove o envio de hoje por canal antes de disparar.
        </p>
      </div>

      {plans.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhum plano aguardando aprovação hoje</CardTitle>
            <CardDescription>
              Quando a automação montar o plano do dia, ele aparece aqui para
              você aprovar.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-4">
          {plans.map((p, idx) => {
            const sample = samples[idx];
            const custo = p.custoEstimadoUsd ? Number(p.custoEstimadoUsd) : 0;
            return (
              <Card key={p.id}>
                <CardHeader className="gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">
                      {CHANNEL_LABEL[p.channel] ?? p.channel}
                    </CardTitle>
                    <Badge variant="secondary">{p.planejado} leads</Badge>
                  </div>
                  <CardDescription>
                    {p.planejado} mensagens planejadas.
                    {p.channel === "whatsapp"
                      ? ` Custo estimado: US$${custo.toFixed(2)}.`
                      : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {sample.length > 0 ? (
                    <ul className="divide-y rounded-lg border text-sm">
                      {sample.map((s) => (
                        <li
                          key={s.leadId}
                          className="flex items-center justify-between gap-2 px-3 py-2"
                        >
                          <span className="font-medium">{s.displayName}</span>
                          <span className="text-xs text-muted-foreground">
                            {p.channel === "whatsapp"
                              ? s.phone ?? "sem telefone"
                              : p.channel === "email"
                                ? s.email ?? "sem email"
                                : s.phone ?? s.email ?? "sem contato"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Sem leads no plano.
                    </p>
                  )}
                  {p.planejado > sample.length ? (
                    <p className="text-xs text-muted-foreground">
                      e mais {p.planejado - sample.length} leads.
                    </p>
                  ) : null}
                  <PlanActions planId={p.id} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
