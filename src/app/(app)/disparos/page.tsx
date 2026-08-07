import { requireOrg } from "@/lib/auth/guards";
import {
  getDispatchReportByDay,
  getDispatchTodaySummary,
  type DispatchDayRow,
} from "@/lib/outreach/dispatch-queries";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

// "Processado" = mensagens que ja saíram da fila (sent + delivered + failed),
// equivalente a d.total apos a correcao de dupla contagem no dispatch-queries.
// O denominador inclui os pendentes para representar o universo completo do dia.
function pctProcessado(d: DispatchDayRow): number {
  const denom = d.total + d.pendentes;
  if (denom <= 0) return 0;
  return Math.round((d.total / denom) * 100);
}

// 'dia' chega como 'YYYY-MM-DD' ja no fuso America/Sao_Paulo, vindo da query.
// Comparamos por string com hoje/ontem locais para nao reintroduzir UTC.
const TZ = "America/Sao_Paulo";

function diaLocalISO(data: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(data);
}

function diaLabel(dia: string): string {
  const agora = new Date();
  const hoje = diaLocalISO(agora);
  const ontem = diaLocalISO(new Date(agora.getTime() - 24 * 60 * 60 * 1000));
  if (dia === hoje) return "Hoje";
  if (dia === ontem) return "Ontem";
  const [ano, mes, d] = dia.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "long",
  }).format(new Date(Date.UTC(ano, mes - 1, d, 12)));
}

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-blue-500 transition-all"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function frasesErro(erros: Record<string, number>): string {
  const partes = Object.entries(erros)
    .sort((a, b) => b[1] - a[1])
    .map(([motivo, qtd]) => `${qtd} ${motivo.toLowerCase()}`);
  return partes.join(", ");
}

export default async function DisparosPage() {
  const { organizationId } = await requireOrg();

  const [hoje, dias] = await Promise.all([
    getDispatchTodaySummary({ organizationId }),
    getDispatchReportByDay({ organizationId, days: 14 }),
  ]);

  const pctHoje = pctProcessado(hoje);
  const erroHoje = frasesErro(hoje.erros);

  const enviadasHoje = hoje.emTransito + hoje.entregues;
  const resumoHoje = hoje.finalizado
    ? `Disparo de hoje: ${enviadasHoje} enviadas${
        erroHoje ? `, ${erroHoje}` : ""
      }, ${hoje.pendentes} pendentes.`
    : `Em andamento: ${hoje.pendentes} na fila, ${enviadasHoje} já enviadas${
        erroHoje ? `, ${erroHoje}` : ""
      }.`;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Disparos</h2>
        <p className="text-sm text-muted-foreground">
          O primeiro disparo de cada lead. &quot;Enviadas&quot; saíram com sucesso;
          &quot;Confirmadas&quot; têm confirmação de entrega (email). As respostas dos
          leads são atendidas pelo agente, não aparecem aqui.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-base">Resumo de hoje</CardTitle>
            <Badge
              className={
                hoje.finalizado
                  ? "bg-success/10 text-success hover:bg-success/10"
                  : "bg-warning/10 text-warning hover:bg-warning/10"
              }
            >
              {hoje.finalizado ? "Finalizado" : "Em andamento"}
            </Badge>
          </div>
          <CardDescription>{resumoHoje}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Metric label="Total" valor={hoje.total + hoje.pendentes} />
            <Metric label="Enviadas" valor={hoje.emTransito + hoje.entregues} cor="text-info" />
            <Metric label="Confirmadas" valor={hoje.entregues} cor="text-success" />
            <Metric label="Com erro" valor={hoje.comErro} cor="text-destructive" />
            <Metric label="Pendentes" valor={hoje.pendentes} cor="text-warning" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Processado</span>
              <span>{pctHoje}%</span>
            </div>
            <ProgressBar pct={pctHoje} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-1">
        <h3 className="text-sm font-semibold tracking-tight text-foreground">
          Últimos 14 dias
        </h3>
      </div>

      {dias.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nenhum disparo no período.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {dias.map((d) => {
            const pct = pctProcessado(d);
            const erro = frasesErro(d.erros);
            return (
              <Card key={d.dia}>
                <CardContent className="space-y-3 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {diaLabel(d.dia)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {d.total + d.pendentes} no total
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    <Pill cor="bg-info/10 text-info">
                      {d.emTransito + d.entregues} enviadas
                    </Pill>
                    {d.entregues > 0 && (
                      <Pill cor="bg-success/10 text-success">
                        {d.entregues} confirmadas
                      </Pill>
                    )}
                    {d.comErro > 0 && (
                      <Pill cor="bg-destructive/10 text-destructive">
                        {d.comErro} com erro
                        {erro ? `: ${erro}` : ""}
                      </Pill>
                    )}
                    {d.pendentes > 0 && (
                      <Pill cor="bg-warning/10 text-warning">
                        {d.pendentes} pendentes
                      </Pill>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Processado</span>
                      <span>{pct}%</span>
                    </div>
                    <ProgressBar pct={pct} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  valor,
  cor = "text-foreground",
}: {
  label: string;
  valor: number;
  cor?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className={`text-lg font-semibold tabular-nums ${cor}`}>{valor}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Pill({
  children,
  cor,
}: {
  children: React.ReactNode;
  cor: string;
}) {
  return (
    <span className={`rounded-full px-2.5 py-1 font-medium ${cor}`}>
      {children}
    </span>
  );
}
