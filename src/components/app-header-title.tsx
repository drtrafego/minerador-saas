"use client";

import { usePathname } from "next/navigation";

// Mapa de prefixo de rota para o titulo exibido no header do shell.
// Ordena por especificidade (prefixo mais longo primeiro) para acertar
// rotas aninhadas como /outreach/plan antes de /outreach.
const ROUTE_TITLES: [string, string][] = [
  ["/dashboard", "Dashboard"],
  ["/mining", "Mineração"],
  ["/leads/import", "Importar leads"],
  ["/leads", "Leads"],
  ["/pipeline", "Pipeline"],
  ["/outreach/plan", "Plano do dia"],
  ["/outreach/new", "Nova campanha"],
  ["/outreach", "Campanhas"],
  ["/inbox", "Inbox"],
  ["/disparos", "Disparos"],
  ["/mensagens", "Mensagens"],
  ["/settings/automation", "Automação"],
  ["/settings/agent/knowledge", "Base de conhecimento"],
  ["/settings/agent", "Agente"],
  ["/settings/credentials/whatsapp", "WhatsApp"],
  ["/settings/credentials/browser", "Navegador"],
  ["/settings/credentials", "Credenciais"],
];

export function AppHeaderTitle() {
  const pathname = usePathname();
  const match = ROUTE_TITLES.filter(([prefix]) => pathname.startsWith(prefix)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0];
  return <span className="text-sm font-medium">{match?.[1] ?? "Minerador Claude"}</span>;
}
