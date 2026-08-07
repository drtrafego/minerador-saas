"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteCredential } from "./actions";

export function DeleteCredentialButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  function onClick() {
    if (!confirm("Deletar esta credential?")) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", id);
      const result = await deleteCredential(fd);
      if (result && "error" in result && result.error) {
        toast.error("Erro ao deletar");
        return;
      }
      toast.success("Credential removida");
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={isPending}
    >
      {isPending ? "..." : "Deletar"}
    </Button>
  );
}
