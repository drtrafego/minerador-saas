"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ICP_TEMPLATES } from "@/lib/icp/templates";
import { generateIcp } from "../actions";

type Props = {
  // Aplica o ICP gerado/escolhido no formulario (preenche prompt e, se houver, o nicho).
  onApply: (prompt: string, niche: string) => void;
};

export function IcpBuilder({ onApply }: Props) {
  const [desc, setDesc] = useState("");
  const [pending, startGen] = useTransition();

  function gerar() {
    const d = desc.trim();
    if (d.length < 3) {
      toast.error("descreva o cliente ideal em uma frase");
      return;
    }
    startGen(async () => {
      const res = await generateIcp(d);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      onApply(res.prompt, "");
      toast.success("ICP gerado. Revise e ajuste o texto abaixo se quiser.");
    });
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Perfil de cliente ideal (ICP)</p>
        <p className="text-xs text-muted-foreground">
          Escolha um modelo de nicho para preencher automaticamente, ou descreva
          seu cliente ideal em uma frase e gere com IA. Você pode ajustar o texto
          depois.
        </p>
      </div>

      <div>
        <p className="mb-1 text-xs uppercase text-muted-foreground">
          Modelos de nicho
        </p>
        <div className="flex flex-wrap gap-2">
          {ICP_TEMPLATES.map((t) => (
            <Button
              key={t.key}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onApply(t.prompt, t.niche);
                toast.success(`Modelo "${t.label}" aplicado. Ajuste se quiser.`);
              }}
            >
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs uppercase text-muted-foreground">
          Ou descreva em 1 frase
        </p>
        <div className="flex flex-wrap gap-2">
          <Input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                gerar();
              }
            }}
            placeholder="Ex: clínicas de estética em SP que faturam bem e ainda não anunciam"
            className="min-w-[16rem] flex-1"
          />
          <Button type="button" onClick={gerar} disabled={pending}>
            {pending ? "Gerando..." : "Gerar com IA"}
          </Button>
        </div>
      </div>
    </div>
  );
}
