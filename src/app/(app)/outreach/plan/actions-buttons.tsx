"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { aprovarPlanoDiario, rejeitarPlanoDiario } from "./actions";

export function PlanActions({ planId }: { planId: string }) {
  const [pending, start] = useTransition();

  function aprovar() {
    start(async () => {
      try {
        const r = await aprovarPlanoDiario({ planId });
        toast.success(`${r.enfileirados} mensagens enfileiradas`);
      } catch (err) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "falha ao aprovar");
      }
    });
  }

  function rejeitar() {
    start(async () => {
      try {
        await rejeitarPlanoDiario({ planId });
        toast.success("plano rejeitado");
      } catch (err) {
        console.error(err);
        toast.error(err instanceof Error ? err.message : "falha ao rejeitar");
      }
    });
  }

  return (
    <div className="flex gap-2">
      <Button onClick={aprovar} disabled={pending}>
        {pending ? "..." : "Aprovar e enviar"}
      </Button>
      <Button variant="outline" onClick={rejeitar} disabled={pending}>
        Rejeitar
      </Button>
    </div>
  );
}
