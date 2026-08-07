"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setActiveCredential } from "./actions";

export function SetActiveCredentialButton({
  id,
  isActive,
}: {
  id: string;
  isActive: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const result = await setActiveCredential(fd);
      if (result && "error" in result && result.error) {
        toast.error("Erro ao ativar chave");
        return;
      }
      toast.success("Chave ativada");
    });
  }

  if (isActive) {
    return (
      <Badge variant="default" className="text-xs">
        Ativa
      </Badge>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={isPending}>
      {isPending ? "..." : "Usar esta"}
    </Button>
  );
}
