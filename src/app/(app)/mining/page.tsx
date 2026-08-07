import Link from "next/link";
import { requireOrg } from "@/lib/auth/guards";
import { listMinings } from "@/lib/db/queries/minings";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "rascunho",
  active: "ativa",
  paused: "pausada",
  archived: "arquivada",
};

const SOURCE_LABEL: Record<string, string> = {
  google_places: "Google Maps",
  instagram_hashtag: "Instagram",
  instagram_profile: "Instagram",
  linkedin_search: "LinkedIn",
  manual: "manual",
};

export default async function MiningPage() {
  const { organizationId } = await requireOrg();
  const campaigns = await listMinings(organizationId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Minerações</h1>
          <p className="text-sm text-muted-foreground">
            Crie minerações de prospecção, mine leads e qualifique com Claude.
          </p>
        </div>
        <Button render={<Link href="/mining/new">Nova mineração</Link>} />
      </div>

      {campaigns.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhuma mineração ainda</CardTitle>
            <CardDescription>
              Crie sua primeira mineração para começar a minerar leads.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/mining/new">Criar mineração</Link>} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((c) => {
            const processados = c.qualifiedLeads + c.disqualifiedLeads;
            const pct =
              c.totalLeads > 0
                ? Math.round((processados / c.totalLeads) * 100)
                : 0;
            return (
              <Link key={c.id} href={`/mining/${c.id}`} className="group">
                <Card className="h-full transition-shadow group-hover:shadow-md">
                  <CardHeader className="gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base group-hover:underline">
                        {c.name}
                      </CardTitle>
                      <Badge variant={c.status === "active" ? "default" : "outline"}>
                        {STATUS_LABEL[c.status] ?? c.status}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {c.primarySource ? (
                        <Badge variant="outline" className="font-normal">
                          {SOURCE_LABEL[c.primarySource] ?? c.primarySource}
                        </Badge>
                      ) : null}
                      {c.niche ? <span>{c.niche}</span> : null}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Qualificação</span>
                        <span className="tabular-nums">{pct}% processado</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-center">
                      <Metric label="Total" value={c.totalLeads} tone="text-foreground" />
                      <Metric label="Qualif." value={c.qualifiedLeads} tone="text-success" />
                      <Metric label="Rejeit." value={c.disqualifiedLeads} tone="text-destructive" />
                      <Metric label="Pend." value={c.pendingLeads} tone="text-warning" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="space-y-0.5">
      <div className={`text-lg font-bold tabular-nums ${tone}`}>{value}</div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
    </div>
  );
}
