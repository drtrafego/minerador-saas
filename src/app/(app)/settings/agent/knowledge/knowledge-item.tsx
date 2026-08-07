"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Trash2 } from "lucide-react";
import { atualizarFatoAction, removerFatoAction, type ActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const estadoInicial: ActionState = { ok: false, message: "" };

export type KnowledgeItemData = {
  id: string;
  title: string;
  content: string;
  tags: string | null;
  sourceDocument: string | null;
  createdAt: string;
};

function BotaoSalvar() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Salvando..." : "Salvar"}
    </Button>
  );
}

function BotaoRemover() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="destructive" disabled={pending}>
      <Trash2 className="h-4 w-4" />
      Remover
    </Button>
  );
}

export function KnowledgeItem({ item }: { item: KnowledgeItemData }) {
  const [editando, setEditando] = useState(false);
  const [estado, action] = useActionState(atualizarFatoAction, estadoInicial);

  if (editando) {
    return (
      <form
        action={action}
        className="space-y-3 rounded-lg border border-border bg-card p-4"
      >
        <input type="hidden" name="id" value={item.id} />
        <div className="space-y-1.5">
          <Label htmlFor={`title-${item.id}`}>Título</Label>
          <Input
            id={`title-${item.id}`}
            name="title"
            required
            defaultValue={item.title}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`content-${item.id}`}>Conteúdo</Label>
          <Textarea
            id={`content-${item.id}`}
            name="content"
            required
            rows={6}
            defaultValue={item.content}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`tags-${item.id}`}>Tags</Label>
          <Input
            id={`tags-${item.id}`}
            name="tags"
            defaultValue={item.tags ?? ""}
            placeholder="preços, serviços, cases"
          />
        </div>
        <div className="flex items-center gap-3">
          <BotaoSalvar />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditando(false)}
          >
            Cancelar
          </Button>
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

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <h3 className="font-medium text-foreground">{item.title}</h3>
          {item.sourceDocument ? (
            <p className="text-xs text-primary">origem: {item.sourceDocument}</p>
          ) : null}
          {item.tags ? (
            <p className="text-xs text-muted-foreground">{item.tags}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setEditando(true)}
          >
            <Pencil className="h-4 w-4" />
            Editar
          </Button>
          <form action={removerFatoAction}>
            <input type="hidden" name="id" value={item.id} />
            <BotaoRemover />
          </form>
        </div>
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
        {item.content}
      </p>
    </div>
  );
}
