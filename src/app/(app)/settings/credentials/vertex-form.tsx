"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveVertexCredential } from "./actions";

type Props = {
  configured: boolean;
  projectId: string | null;
  location: string | null;
  model: string | null;
};

export function VertexForm({ configured, projectId, location, model }: Props) {
  const [isPending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(!configured);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveVertexCredential(fd);
      if (result && "error" in result) {
        const errObj = result.error as Record<string, string[] | undefined>;
        const msgs = Object.values(errObj).flatMap((v) => v ?? []).join("; ");
        toast.error(`Erro ao salvar Vertex AI: ${msgs}`);
        return;
      }
      toast.success("Vertex AI configurado com sucesso");
      setShowForm(false);
    });
  }

  if (configured && !showForm) {
    return (
      <div className="flex items-center justify-between">
        <div className="text-sm space-y-0.5">
          <div className="font-medium">{projectId}</div>
          <div className="text-muted-foreground text-xs">
            {location ?? "us-central1"}
            {model ? ` · ${model}` : ""}
          </div>
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
        <Label htmlFor="vertex-sa-json">Service Account JSON</Label>
        <Textarea
          id="vertex-sa-json"
          name="serviceAccountJson"
          rows={6}
          placeholder='{"type":"service_account","project_id":"meu-projeto",...}'
          required
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          Gere em console.cloud.google.com &gt; IAM &gt; Contas de serviço &gt; Chaves &gt; Adicionar chave JSON.
          O projeto precisa ter a API Vertex AI ativada e billing habilitado.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="vertex-location">Região (opcional)</Label>
          <Input
            id="vertex-location"
            name="location"
            placeholder="us-central1"
            defaultValue={location ?? "us-central1"}
          />
          <p className="text-xs text-muted-foreground">
            Região GCP onde o modelo será chamado.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="vertex-model">Modelo padrão</Label>
          <select
            id="vertex-model"
            name="model"
            defaultValue={model ?? "gemini-2.5-flash"}
            className="flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-background [&>option]:text-foreground"
          >
            <option value="gemini-2.5-flash">Gemini 2.5 Flash (rápido e barato, recomendado)</option>
            <option value="gemini-2.5-pro">Gemini 2.5 Pro (mais poderoso)</option>
            <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash-Lite (mais econômico)</option>
            <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Modelo padrão da org. Cada finalidade (agente, qualificação, follow-up) pode ter o seu em Configurações do agente.
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
