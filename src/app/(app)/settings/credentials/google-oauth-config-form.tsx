"use client";

import { useTransition, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveGoogleOAuthConfig } from "./actions";

export function GoogleOAuthConfigForm({
  configured,
  clientIdPreview,
}: {
  configured: boolean;
  clientIdPreview: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await saveGoogleOAuthConfig(fd);
      if ("ok" in res && res.ok) {
        toast.success("Credenciais Google salvas");
        setOpen(false);
      } else {
        toast.error("Erro ao salvar. Verifique os campos.");
      }
    });
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        {configured ? (
          <div className="text-sm">
            <p className="font-medium">Client ID: {clientIdPreview}</p>
            <p className="text-xs text-muted-foreground">Configurado</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Não configurado</p>
        )}
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          {configured ? "Atualizar" : "Configurar"}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="clientId">Client ID</Label>
        <Input
          id="clientId"
          name="clientId"
          placeholder="123456789-abc.apps.googleusercontent.com"
          required
        />
        <p className="text-xs text-muted-foreground">
          Encontrado em Google Cloud Console &gt; Credenciais &gt; ID do cliente OAuth 2.0
        </p>
      </div>
      <div className="space-y-1">
        <Label htmlFor="clientSecret">Client Secret</Label>
        <Input
          id="clientSecret"
          name="clientSecret"
          type="password"
          placeholder="GOCSPX-..."
          required
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Salvando..." : "Salvar"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
