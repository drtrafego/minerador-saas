"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveHermesCredential, disconnectHermes } from "./actions";

type Props = {
  configured: boolean;
  baseUrl: string | null;
  model: string | null;
};

export function HermesForm({ configured, baseUrl, model }: Props) {
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(!configured);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveHermesCredential(fd);
      if (result && "error" in result) {
        const errObj = result.error as Record<string, string[] | undefined>;
        const msgs = Object.values(errObj).flatMap((v) => v ?? []).join("; ");
        toast.error(`Erro ao salvar Hermes: ${msgs}`);
        return;
      }
      toast.success("Hermes configurado com sucesso");
      setShowForm(false);
    });
  }

  function onDisconnect() {
    if (!confirm("Desconectar o Hermes? O atendimento volta para o Gemini/Vertex.")) return;
    startTransition(async () => {
      await disconnectHermes();
      toast.success("Hermes desconectado");
      setShowForm(true);
    });
  }

  if (configured && !showForm) {
    return (
      <div className="flex items-center justify-between">
        <div className="text-sm space-y-0.5">
          <div className="font-medium">{baseUrl}</div>
          <div className="text-muted-foreground text-xs">
            {model ? `modelo: ${model}` : "modelo padrao do container"}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
            Alterar
          </Button>
          <Button variant="ghost" size="sm" onClick={onDisconnect} disabled={isPending}>
            Desconectar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="hermes-base-url">URL do servidor Hermes</Label>
        <Input
          id="hermes-base-url"
          name="baseUrl"
          placeholder="https://seu-servico.seu-dominio.com"
          defaultValue={baseUrl ?? ""}
          required
        />
        <p className="text-xs text-muted-foreground">
          Endereco do container Hermes (sem o /v1 no fim). Use HTTPS em producao.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="hermes-api-key">API Key (API_SERVER_KEY)</Label>
          <Input
            id="hermes-api-key"
            name="apiKey"
            type="password"
            placeholder="chave do container"
            required
          />
          <p className="text-xs text-muted-foreground">
            O valor de API_SERVER_KEY definido no container Hermes.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="hermes-model">Modelo (opcional)</Label>
          <Input
            id="hermes-model"
            name="model"
            placeholder="hermes"
            defaultValue={model ?? ""}
          />
          <p className="text-xs text-muted-foreground">
            Nome que o Hermes expoe em /v1/models. Em branco usa &quot;hermes&quot;.
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
        {configured && (
          <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
