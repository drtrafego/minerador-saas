/**
 * Bolha de mensagem estilo WhatsApp.
 * Outbound: direita, fundo verde-claro.
 * Inbound: esquerda, fundo branco com borda.
 */
export function MessageBubble({
  direction,
  body,
  subject,
  timestamp,
  status,
  isManual,
  errorReason,
}: {
  direction: "inbound" | "outbound";
  body: string;
  subject?: string | null;
  timestamp?: Date | string | null;
  status?: string | null;
  isManual?: boolean;
  errorReason?: string | null;
}) {
  const isOutbound = direction === "outbound";

  const ts = timestamp
    ? new Date(timestamp).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
      })
    : null;

  return (
    <div className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words sm:max-w-[75%] ${
          isOutbound
            ? "bg-success/15 text-foreground rounded-br-sm"
            : "bg-card text-foreground rounded-bl-sm border border-border"
        }`}
      >
        {subject ? (
          <p className="text-xs font-semibold opacity-70 mb-1">{subject}</p>
        ) : null}
        <div>{body}</div>
        <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] opacity-60">
          {isOutbound && isManual ? <span>você</span> : null}
          {isOutbound && !isManual ? <span>bot</span> : null}
          {isOutbound && status === "failed" ? (
            <span className="text-destructive opacity-100">falhou</span>
          ) : null}
          {ts ? <span>{ts}</span> : null}
        </div>
        {errorReason ? (
          <p className="text-xs text-destructive mt-1">erro: {errorReason}</p>
        ) : null}
      </div>
    </div>
  );
}
