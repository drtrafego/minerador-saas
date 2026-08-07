"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveBrevoCredential } from "./actions";

type Props = {
  configured: boolean;
  senderEmail: string | null;
  senderName: string | null;
  replyToEmail: string | null;
};

export function BrevoForm({ configured, senderEmail, senderName, replyToEmail }: Props) {
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(!configured);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveBrevoCredential(fd);
      if (result && "error" in result) {
        toast.error("Erro ao salvar credencial Brevo");
        return;
      }
      toast.success("Brevo configurado com sucesso");
      setShowForm(false);
    });
  }

  if (configured && !showForm) {
    return (
      <div className="flex items-center justify-between">
        <div className="text-sm">
          <span className="font-medium">{senderEmail}</span>
          {senderName ? (
            <span className="ml-2 text-muted-foreground">({senderName})</span>
          ) : null}
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
          Alterar
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="brevo-apiKey">API Key</Label>
        <Input
          id="brevo-apiKey"
          name="apiKey"
          type="password"
          placeholder="xkeysib-..."
          required
        />
        <p className="text-xs text-muted-foreground">
          Encontre em app.brevo.com → SMTP e API → Chaves de API
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="brevo-senderEmail">Email remetente</Label>
        <Input
          id="brevo-senderEmail"
          name="senderEmail"
          type="email"
          placeholder="contato@suaempresa.com"
          defaultValue={senderEmail ?? ""}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="brevo-senderName">Nome do remetente (opcional)</Label>
        <Input
          id="brevo-senderName"
          name="senderName"
          type="text"
          placeholder="Sua Empresa"
          defaultValue={senderName ?? ""}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="brevo-replyToEmail">Email de resposta reply-to (opcional)</Label>
        <Input
          id="brevo-replyToEmail"
          name="replyToEmail"
          type="email"
          placeholder="lead@seu-dominio.email"
          defaultValue={replyToEmail ?? ""}
        />
        <p className="text-xs text-muted-foreground">
          Recebe as respostas dos leads. Use o subdominio de inbound para que o agente processe automaticamente (ex: lead@seu-dominio.email).
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
        {configured && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowForm(false)}
          >
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
