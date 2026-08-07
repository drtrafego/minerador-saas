"use client";

import { useEffect, useState } from "react";

const JANELA_MS = 24 * 60 * 60 * 1000;
const ALERTA_MS = 2 * 60 * 60 * 1000;

type Estado = "verde" | "amarelo" | "vermelho" | "cinza";

function formatarRestante(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const horas = Math.floor(totalMin / 60);
  const minutos = totalMin % 60;
  return `${horas}h${String(minutos).padStart(2, "0")}m`;
}

function calcular(
  lastInboundAt: string | null,
  agora: number,
): { estado: Estado; texto: string } {
  if (!lastInboundAt) {
    return { estado: "cinza", texto: "Sem resposta do lead, só template" };
  }
  const deadline = new Date(lastInboundAt).getTime() + JANELA_MS;
  const restante = deadline - agora;

  if (restante <= 0) {
    return { estado: "vermelho", texto: "Janela fechada, só template" };
  }
  if (restante <= ALERTA_MS) {
    return { estado: "amarelo", texto: `Fecha em ${formatarRestante(restante)}` };
  }
  return {
    estado: "verde",
    texto: `Janela aberta, faltam ${formatarRestante(restante)}`,
  };
}

const ESTILOS: Record<
  Estado,
  { pilula: string; bolinha: string; pulsa: boolean }
> = {
  verde: {
    pilula: "bg-success/10 text-success",
    bolinha: "bg-green-500",
    pulsa: false,
  },
  amarelo: {
    pilula: "bg-warning/10 text-warning",
    bolinha: "bg-amber-500",
    pulsa: true,
  },
  vermelho: {
    pilula: "bg-destructive/10 text-destructive",
    bolinha: "bg-red-500",
    pulsa: false,
  },
  cinza: {
    pilula: "bg-muted text-muted-foreground",
    bolinha: "bg-muted-foreground",
    pulsa: false,
  },
};

/**
 * Indicador de janela de 24h do WhatsApp.
 * Calcular deadline = lastInboundAt + 24h e exibir 4 estados.
 * Atualiza a cada 30s automaticamente.
 * Só deve ser renderizado quando channel === "whatsapp".
 */
export function Janela24h({
  lastInboundAt,
}: {
  lastInboundAt: string | null;
}) {
  const [mounted, setMounted] = useState(false);
  const [agora, setAgora] = useState(0);

  useEffect(() => {
    setMounted(true);
    setAgora(Date.now());
    const id = setInterval(() => setAgora(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  if (!mounted) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-muted-foreground" />
        Janela 24h
      </span>
    );
  }

  const { estado, texto } = calcular(lastInboundAt, agora);
  const estilo = ESTILOS[estado];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${estilo.pilula}`}
    >
      <span
        className={`h-2 w-2 rounded-full ${estilo.bolinha} ${estilo.pulsa ? "animate-pulse" : ""}`}
      />
      {texto}
    </span>
  );
}
