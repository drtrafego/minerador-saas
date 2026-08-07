import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth/guards";
import {
  getMiningById,
  getMiningCounters,
  getMiningScrapingJobs,
  getMiningSources,
} from "@/lib/db/queries/minings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MiningActions } from "./actions-bar";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  draft: "rascunho",
  active: "ativa",
  paused: "pausada",
  archived: "arquivada",
};

const JOB_STATUS_LABEL: Record<string, string> = {
  pending: "pendente",
  running: "executando",
  completed: "concluído",
  failed: "falhou",
  cancelled: "cancelado",
};

export default async function MiningDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { organizationId } = await requireOrg();

  const campaign = await getMiningById(organizationId, id);
  if (!campaign) notFound();

  const [sources, counters, jobs] = await Promise.all([
    getMiningSources(organizationId, id),
    getMiningCounters(organizationId, id),
    getMiningScrapingJobs(organizationId, id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{campaign.name}</h1>
            <Badge
              variant={campaign.status === "active" ? "default" : "outline"}
            >
              {STATUS_LABEL[campaign.status] ?? campaign.status}
            </Badge>
          </div>
          {campaign.niche ? (
            <p className="text-sm text-muted-foreground">
              Nicho: {campaign.niche}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            render={<Link href={`/mining/${id}/leads`}>Ver leads</Link>}
          />
          <MiningActions
            miningId={id}
            status={campaign.status}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total</CardDescription>
            <CardTitle className="text-2xl">{counters.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Qualificados</CardDescription>
            <CardTitle className="text-2xl text-success">
              {counters.qualified}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Rejeitados</CardDescription>
            <CardTitle className="text-2xl text-destructive">
              {counters.disqualified}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Pendentes</CardDescription>
            <CardTitle className="text-2xl text-yellow-500">
              {counters.pending}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Fontes</CardTitle>
          <CardDescription>
            Configuração de scraping da campanha.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem fontes</p>
          ) : (
            <ul className="space-y-2">
              {sources.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between rounded border p-3"
                >
                  <div>
                    <p className="text-sm font-medium">{s.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {JSON.stringify(s.config)}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {s.lastRunAt
                      ? `último run: ${new Date(s.lastRunAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                      : "nunca rodou"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Histórico de scraping</CardTitle>
          <CardDescription>Últimos 20 jobs.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {jobs.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Nenhum job ainda
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Encontrados</TableHead>
                  <TableHead className="text-right">Inseridos</TableHead>
                  <TableHead>Erro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="text-xs">
                      {new Date(j.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    </TableCell>
                    <TableCell className="text-xs">{j.sourceType}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          j.status === "completed"
                            ? "default"
                            : j.status === "failed"
                              ? "destructive"
                              : "outline"
                        }
                      >
                        {JOB_STATUS_LABEL[j.status] ?? j.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{j.leadsFound}</TableCell>
                    <TableCell className="text-right">
                      {j.leadsInserted}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-destructive">
                      {j.error ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
