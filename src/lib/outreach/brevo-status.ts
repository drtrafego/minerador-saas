// Status retornado como null indica que o evento nao deve alterar o status
// da mensagem (spam, descadastro e eventos informativos como request/deferred).
export type BrevoMapped = {
  status: "delivered" | "failed" | null;
  label: string;
};

// Mapeia o evento do webhook transacional do Brevo para o status interno.
// Eventos de abertura e clique mapeiam para "delivered" porque o enum deste
// projeto nao possui o valor "read"; eles sao registrados na tabela de eventos
// para auditoria mesmo quando o status da mensagem ja e "delivered".
export function mapBrevoEvent(event: string, reason?: string | null): BrevoMapped {
  const r = reason?.trim();
  switch (event) {
    case "delivered":
      return { status: "delivered", label: "Entregue" };
    case "opened":
    case "unique_opened":
    case "proxy_open":
    case "unique_proxy_open":
    case "click":
      return { status: "delivered", label: "Aberto" };
    case "hard_bounce":
      return { status: "failed", label: r ? `Hard bounce: ${r}` : "Hard bounce" };
    case "blocked":
      return { status: "failed", label: "Bloqueado" };
    case "invalid_email":
      return { status: "failed", label: "Email inválido" };
    case "error":
      return { status: "failed", label: r ? `Erro: ${r}` : "Erro no envio" };
    case "spam":
      return { status: null, label: "Marcou como spam" };
    case "unsubscribed":
      return { status: null, label: "Descadastrou" };
    default:
      // request, deferred, soft_bounce e similares sao ignorados.
      return { status: null, label: "" };
  }
}
