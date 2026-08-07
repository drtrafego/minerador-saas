"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { criarFatoAction, type ActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const estadoInicial: ActionState = { ok: false, message: "" };

function BotaoAdicionar() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Salvando..." : "Adicionar fato"}
    </Button>
  );
}

export function KnowledgeForm() {
  const [estado, action] = useActionState(criarFatoAction, estadoInicial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (estado.ok) {
      formRef.current?.reset();
    }
  }, [estado]);

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="title">Título</Label>
        <Input
          id="title"
          name="title"
          required
          placeholder="Ex: Tabela de preços de tráfego"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="content">Conteúdo</Label>
        <Textarea
          id="content"
          name="content"
          required
          rows={6}
          placeholder="Texto que o agente vai consultar para responder."
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tags">Tags (opcional)</Label>
        <Input id="tags" name="tags" placeholder="preços, serviços, cases" />
      </div>

      <div className="flex items-center gap-3">
        <BotaoAdicionar />
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
