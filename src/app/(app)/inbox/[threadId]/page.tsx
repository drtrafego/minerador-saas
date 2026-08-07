import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth/guards";
import { getInboxThread } from "@/lib/db/queries/inbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatActions } from "./chat-actions";
import { Janela24h } from "@/components/inbox/janela-24h";
import { ConversationPoller } from "@/components/inbox/conversation-poller";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram_dm: "Instagram",
  linkedin_dm: "LinkedIn",
  email: "Email",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "na fila",
  active: "ativo",
  awaiting_reply: "aguardando",
  replied: "respondeu",
  booked: "agendado",
  dead: "encerrado",
  finished: "concluído",
  failed: "falhou",
};

const TEMPERATURE_LABEL: Record<string, string> = {
  cold: "Frio",
  warm: "Morno",
  hot: "Quente",
};

const TEMPERATURE_COR: Record<string, string> = {
  cold: "bg-info/10 text-info",
  warm: "bg-warning/10 text-warning",
  hot: "bg-destructive/10 text-destructive",
};

const ACTIVITY_LABEL: Record<string, string> = {
  note: "Nota",
  call: "Ligação",
  email: "Email",
  meeting: "Reunião",
  whatsapp: "WhatsApp",
  task: "Tarefa",
};

export default async function InboxThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const { organizationId } = await requireOrg();

  const detail = await getInboxThread(organizationId, threadId);
  if (!detail) notFound();

  const isWhatsApp = detail.thread.channel === "whatsapp";
  const lastInboundAt = detail.thread.lastInboundAt
    ? detail.thread.lastInboundAt.toISOString()
    : null;

  // Atividade de qualificação BANT (tipo note com "Qualificacao BANT" no título)
  const bantActivity = detail.activities.find(
    (a) =>
      a.type === "note" &&
      a.title.toLowerCase().includes("qualificacao bant"),
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
      {/* Coluna principal */}
      <div className="flex min-w-0 flex-col space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link
              href="/inbox"
              className="text-xs text-muted-foreground hover:underline"
            >
              voltar para inbox
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold">
                {detail.lead.displayName}
              </h1>
              <Badge variant="outline">
                {CHANNEL_LABEL[detail.thread.channel] ?? detail.thread.channel}
              </Badge>
              <Badge variant="secondary">
                {STATUS_LABEL[detail.thread.status] ?? detail.thread.status}
              </Badge>
              {isWhatsApp ? (
                <Janela24h lastInboundAt={lastInboundAt} />
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {detail.lead.email ? <span>{detail.lead.email}</span> : null}
              {detail.lead.phone ? <span>{detail.lead.phone}</span> : null}
              {detail.lead.handle ? <span>@{detail.lead.handle}</span> : null}
              {detail.lead.city ? <span>{detail.lead.city}</span> : null}
              {detail.campaign ? (
                <Link
                  href={`/mining/${detail.campaign.id}`}
                  className="underline"
                >
                  {detail.campaign.name}
                </Link>
              ) : null}
            </div>
          </div>
          <Button variant="outline" render={<Link href="/inbox">Voltar</Link>} />
        </div>

        {/* Auto-refresh invisível */}
        <ConversationPoller intervalMs={10000} />

        <ChatActions
          threadId={detail.thread.id}
          channel={detail.thread.channel}
          botPaused={detail.thread.botPaused}
          messages={detail.messages}
        />
      </div>

      {/* Sidebar */}
      <aside className="space-y-4">
        {/* Bloco qualificação */}
        <section className="rounded-lg border p-4 space-y-2">
          <h3 className="text-sm font-semibold">Qualificação</h3>

          <div className="flex items-center gap-2">
            {detail.lead.qualificationScore != null ? (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">Score:</span>
                <span
                  className={`text-sm font-bold ${
                    detail.lead.qualificationScore >= 70
                      ? "text-success"
                      : detail.lead.qualificationScore >= 40
                        ? "text-warning"
                        : "text-muted-foreground"
                  }`}
                >
                  {detail.lead.qualificationScore}/100
                </span>
              </div>
            ) : null}

            {detail.lead.temperature ? (
              <span
                className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                  TEMPERATURE_COR[detail.lead.temperature] ??
                  "bg-muted text-muted-foreground"
                }`}
              >
                {TEMPERATURE_LABEL[detail.lead.temperature] ??
                  detail.lead.temperature}
              </span>
            ) : null}
          </div>

          {detail.lead.qualificationReason ? (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {detail.lead.qualificationReason}
            </p>
          ) : null}

          {bantActivity ? (
            <div className="rounded border-l-2 border-success pl-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">BANT: </span>
              {bantActivity.description ?? bantActivity.title}
            </div>
          ) : null}

          {!detail.lead.qualificationScore &&
          !detail.lead.temperature &&
          !bantActivity ? (
            <p className="text-xs text-muted-foreground">
              Sem qualificação ainda.
            </p>
          ) : null}
        </section>

        {/* Bloco atividades recentes */}
        <section className="rounded-lg border p-4 space-y-2">
          <h3 className="text-sm font-semibold">Atividades recentes</h3>
          {detail.activities.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem atividades.</p>
          ) : (
            <ul className="space-y-2">
              {detail.activities.map((a) => (
                <li
                  key={a.id}
                  className="border-l-2 border-muted pl-2 text-xs"
                >
                  <div className="text-muted-foreground">
                    {ACTIVITY_LABEL[a.type] ?? a.type}
                    {" · "}
                    {new Date(a.createdAt).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <div
                    className={`font-medium truncate ${a.completedAt ? "line-through opacity-60" : ""}`}
                  >
                    {a.title}
                  </div>
                  {a.description ? (
                    <div className="text-muted-foreground line-clamp-2">
                      {a.description}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
