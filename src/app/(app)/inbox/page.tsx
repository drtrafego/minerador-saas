import Link from "next/link";
import { Bot, User } from "lucide-react";
import { requireOrg } from "@/lib/auth/guards";
import {
  listInboxThreads,
  countInboxRespondendo,
  countInboxNovaMsg,
} from "@/lib/db/queries/inbox";
import { listPipelineStages } from "@/lib/db/queries/pipeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge, toneForStatus } from "@/components/status-badge";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  queued: "na fila",
  active: "ativo",
  awaiting_reply: "aguardando",
  replied: "respondeu",
  booked: "agendado",
  dead: "encerrado",
  finished: "concluido",
  failed: "falhou",
};

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  instagram_dm: "Instagram",
  linkedin_dm: "LinkedIn",
};

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; q?: string; stage?: string }>;
}) {
  const sp = await searchParams;
  const { organizationId } = await requireOrg();

  const filtro =
    sp.filtro === "nova_msg" ||
    sp.filtro === "respondendo" ||
    sp.filtro === "todas"
      ? sp.filtro
      : undefined;
  const q = sp.q?.trim() || undefined;
  const stageId = sp.stage || undefined;

  const [threads, stages, totalRespondendo, totalNovaMsg] = await Promise.all([
    listInboxThreads(organizationId, { filtro, q, stageId }),
    listPipelineStages(organizationId),
    countInboxRespondendo(organizationId, { q, stageId }),
    countInboxNovaMsg(organizationId, { q, stageId }),
  ]);

  const abaAtiva: "nova_msg" | "respondendo" | "todas" =
    filtro === "nova_msg"
      ? "nova_msg"
      : filtro === "respondendo"
        ? "respondendo"
        : "todas";

  function hrefAba(valor: "nova_msg" | "respondendo" | "todas") {
    const params = new URLSearchParams();
    params.set("filtro", valor);
    if (q) params.set("q", q);
    if (stageId) params.set("stage", stageId);
    return `/inbox?${params.toString()}`;
  }

  function hrefStage(id: string | null) {
    const params = new URLSearchParams();
    if (filtro) params.set("filtro", filtro);
    if (q) params.set("q", q);
    if (id) params.set("stage", id);
    const qs = params.toString();
    return qs ? `/inbox?${qs}` : "/inbox";
  }

  function hrefLimparBusca() {
    const params = new URLSearchParams();
    if (filtro) params.set("filtro", filtro);
    if (stageId) params.set("stage", stageId);
    const qs = params.toString();
    return qs ? `/inbox?${qs}` : "/inbox";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            {totalNovaMsg > 0 ? (
              <>
                <span className="font-medium text-warning">
                  {totalNovaMsg}{" "}
                  {totalNovaMsg === 1 ? "aguardando resposta" : "aguardando resposta"}
                </span>
                {" · "}
              </>
            ) : null}
            {totalRespondendo} respondendo, {threads.length} conversas
          </p>
        </div>
      </div>

      {/* Abas */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={abaAtiva === "todas" ? "default" : "outline"}
          className="rounded-full"
          render={<Link href={hrefAba("todas")}>Todas</Link>}
        />
        <Button
          size="sm"
          variant={abaAtiva === "respondendo" ? "default" : "outline"}
          className="rounded-full"
          render={
            <Link href={hrefAba("respondendo")}>
              Respondendo
              {totalRespondendo > 0 ? (
                <span className="ml-1.5 rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {totalRespondendo}
                </span>
              ) : null}
            </Link>
          }
        />
        <Button
          size="sm"
          variant={abaAtiva === "nova_msg" ? "default" : "outline"}
          className="rounded-full"
          render={
            <Link href={hrefAba("nova_msg")}>
              Nova mensagem
              {totalNovaMsg > 0 ? (
                <span className="ml-1.5 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {totalNovaMsg}
                </span>
              ) : null}
            </Link>
          }
        />
      </div>

      {/* Busca */}
      <form
        method="GET"
        action="/inbox"
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
      >
        {filtro ? <input type="hidden" name="filtro" value={filtro} /> : null}
        {stageId ? <input type="hidden" name="stage" value={stageId} /> : null}
        <Input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Buscar por nome ou telefone"
          className="w-full sm:max-w-md"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm">
            Buscar
          </Button>
          {q ? (
            <Button
              size="sm"
              variant="ghost"
              render={<Link href={hrefLimparBusca()}>Limpar</Link>}
            />
          ) : null}
        </div>
      </form>

      {/* Filtro por etapa */}
      {stages.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Etapa:</span>
          <Button
            size="sm"
            variant={!stageId ? "default" : "secondary"}
            className="rounded-full text-xs h-6 px-2"
            render={<Link href={hrefStage(null)}>Todas</Link>}
          />
          {stages.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={stageId === s.id ? "default" : "secondary"}
              className="rounded-full text-xs h-6 px-2"
              render={<Link href={hrefStage(s.id)}>{s.name}</Link>}
            />
          ))}
        </div>
      ) : null}

      {/* Lista */}
      {threads.length === 0 ? (
        <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
          {abaAtiva === "nova_msg"
            ? "Nenhuma mensagem nova aguardando resposta com os filtros atuais."
            : abaAtiva === "respondendo"
              ? "Nenhum lead respondeu ainda com os filtros atuais."
              : "Nenhuma conversa com os filtros atuais."}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <ul className="divide-y">
            {threads.map((t) => {
              const lastAt =
                t.lastInboundAt ?? t.lastOutboundAt ?? t.updatedAt;
              const respondeu = t.lastInboundAt != null;
              // nova_mensagem: lead respondeu apos o ultimo outbound (aguardando resposta)
              const isNovaMsg =
                t.lastInboundAt != null &&
                t.lastInboundAt.getTime() > (t.lastOutboundAt?.getTime() ?? 0);
              const isInbound = t.lastMessageDirection === "inbound";
              const preview = t.lastMessageBody?.trim() ?? "";

              return (
                <li
                  key={t.id}
                  className={
                    isNovaMsg
                      ? "bg-warning/[0.07]"
                      : respondeu
                        ? "bg-success/[0.06]"
                        : undefined
                  }
                >
                  <Link
                    href={`/inbox/${t.id}`}
                    className="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
                  >
                    {/* indicador de estado */}
                    {isNovaMsg ? (
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-warning"
                        aria-hidden
                      />
                    ) : respondeu ? (
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-success"
                        aria-hidden
                      />
                    ) : (
                      <span className="mt-1.5 h-2 w-2 shrink-0" aria-hidden />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium truncate">{t.leadName}</span>
                        {t.leadPhone ? (
                          <span className="text-xs text-muted-foreground">
                            {t.leadPhone}
                          </span>
                        ) : null}
                        {isNovaMsg ? (
                          <StatusBadge tone="warning">Nova mensagem</StatusBadge>
                        ) : respondeu ? (
                          <StatusBadge tone="success">Respondeu</StatusBadge>
                        ) : null}
                        <Badge variant="outline" className="text-[10px] h-4">
                          {CHANNEL_LABEL[t.channel] ?? t.channel}
                        </Badge>
                        <StatusBadge tone={toneForStatus(t.status)}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </StatusBadge>
                        {t.botPaused ? (
                          <User className="h-3 w-3 text-warning" />
                        ) : (
                          <Bot className="h-3 w-3 text-info" />
                        )}
                      </div>

                      {preview ? (
                        <div
                          className={
                            "truncate text-sm mt-0.5 " +
                            (isInbound
                              ? "font-medium text-foreground"
                              : "text-muted-foreground")
                          }
                        >
                          {isInbound ? (
                            <span className="text-success mr-1">↩</span>
                          ) : null}
                          {preview}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                        {new Date(lastAt).toLocaleString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      {t.campaignName ? (
                        <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">
                          {t.campaignName}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
