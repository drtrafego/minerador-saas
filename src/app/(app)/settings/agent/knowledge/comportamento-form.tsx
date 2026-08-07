"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { salvarComportamentoAction, type ActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const estadoInicial: ActionState = { ok: false, message: "" };

function BotaoSalvar() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Salvando..." : "Salvar comportamento"}
    </Button>
  );
}

export function ComportamentoForm({ comportamento }: { comportamento: string }) {
  const [estado, action] = useActionState(salvarComportamentoAction, estadoInicial);
  const [texto, setTexto] = useState(comportamento);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="comportamento">Instruções de comportamento</Label>
        <Textarea
          id="comportamento"
          name="comportamento"
          rows={20}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="font-mono text-xs"
          placeholder="Você é Isabela, do setor de prospecção..."
        />
        <p className="text-xs text-muted-foreground">
          Isso <strong>substitui</strong> o comportamento atual. Salvar aqui reescreve
          completamente o system prompt do agente.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <BotaoSalvar />
        {estado.message ? (
          <span
            className={`text-sm ${estado.ok ? "text-success" : "text-destructive"}`}
          >
            {estado.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
