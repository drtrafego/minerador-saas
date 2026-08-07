export type ChannelOutreachState =
  | "nova_mensagem"
  | "respondeu"
  | "abordado"
  | "falhou"
  | "opt_out"
  | "na_fila"
  | "sem_disparo";

/**
 * Badge de status de outreach por canal.
 * Estados mapeados pela ordem de prioridade:
 *   nova_mensagem (laranja) -> lastInboundAt mais recente que lastOutboundAt (aguardando resposta)
 *   respondeu    (verde)   -> lastInboundAt preenchido, ja respondido
 *   abordado     (azul)    -> lastOutboundAt preenchido
 *   falhou       (vermelho) -> status=failed
 *   opt-out      (ambar)   -> lead.doNotDisturb
 *   na fila      (slate)   -> thread ativo sem outbound
 *   sem disparo  (slate claro) -> sem thread
 */
export function OutreachBadge({ state }: { state: ChannelOutreachState }) {
  let label: string;
  let cls: string;

  switch (state) {
    case "nova_mensagem":
      label = "Nova mensagem";
      cls = "bg-warning text-warning-foreground";
      break;
    case "respondeu":
      label = "Respondeu";
      cls = "bg-success/10 text-success";
      break;
    case "abordado":
      label = "Abordado";
      cls = "bg-info/10 text-info";
      break;
    case "falhou":
      label = "Falhou";
      cls = "bg-destructive/10 text-destructive";
      break;
    case "opt_out":
      label = "Opt-out";
      cls = "bg-warning/10 text-warning";
      break;
    case "na_fila":
      label = "Na fila";
      cls = "bg-muted text-muted-foreground";
      break;
    default:
      label = "Sem disparo";
      cls = "bg-muted/50 text-muted-foreground";
  }

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  );
}

/**
 * Converte Date ou string ISO para milissegundos.
 * Necessario porque em Client Components o Next.js serializa Date como string ISO,
 * enquanto em Server Components sao objetos Date reais.
 */
function toMs(d: Date | null): number {
  if (!d) return 0;
  if (d instanceof Date) return d.getTime();
  // Fallback para string ISO (runtime em Client Components)
  return new Date(d as unknown as string).getTime();
}

/**
 * Calcula o estado do badge a partir dos campos do outreach_thread.
 * Ordem de prioridade:
 *   doNotDisturb          -> opt_out
 *   lastInboundAt > lastOutboundAt -> nova_mensagem  (aguardando resposta)
 *   lastInboundAt preenchido       -> respondeu       (ja respondido)
 *   threadStatus==="failed"        -> falhou
 *   lastOutboundAt preenchido      -> abordado
 *   threadStatus!=null             -> na_fila
 *   senao                          -> sem_disparo
 */
export function resolveOutreachState(opts: {
  doNotDisturb: boolean;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  threadStatus: string | null;
}): ChannelOutreachState {
  if (opts.doNotDisturb) return "opt_out";
  if (opts.lastInboundAt) {
    const inboundMs = toMs(opts.lastInboundAt);
    const outboundMs = toMs(opts.lastOutboundAt);
    // nova_mensagem: lead respondeu apos o ultimo outbound (aguardando resposta do humano/bot)
    if (outboundMs === 0 || inboundMs > outboundMs) return "nova_mensagem";
    return "respondeu";
  }
  if (opts.threadStatus === "failed") return "falhou";
  if (opts.lastOutboundAt) return "abordado";
  if (opts.threadStatus !== null) return "na_fila";
  return "sem_disparo";
}
