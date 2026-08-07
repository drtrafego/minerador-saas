"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { disconnectGmail } from "./actions";

export function GmailConnectButton({
  connectedEmail,
}: {
  connectedEmail: string | null;
}) {
  const [pending, start] = useTransition();

  function connect() {
    window.location.href = "/api/auth/google/start";
  }

  function disconnect() {
    if (!confirm("Desconectar conta Gmail?")) return;
    start(async () => {
      const res = await disconnectGmail();
      if ("ok" in res && res.ok) {
        toast.success("Conta Gmail desconectada");
      } else {
        toast.error("Falha ao desconectar");
      }
    });
  }

  if (connectedEmail) {
    return (
      <div className="flex items-center gap-3">
        <div className="text-sm">
          <p className="font-medium">{connectedEmail}</p>
          <p className="text-xs text-muted-foreground">Gmail conectado</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={disconnect}
          disabled={pending}
        >
          {pending ? "..." : "Desconectar"}
        </Button>
      </div>
    );
  }

  return (
    <Button onClick={connect} disabled={pending}>
      Conectar Gmail
    </Button>
  );
}
