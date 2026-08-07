"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Trash2 } from "lucide-react";
import {
  analisarDocumentoAction,
  confirmarCerebroAction,
  type AnaliseState,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const estadoInicial: AnaliseState = { ok: false, message: "" };

type Fato = { _key: string; title: string; content: string };

function BotaoAnalisar() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Analisando..." : "Analisar"}
    </Button>
  );
}

export function UploadCerebro() {
  const [estado, action] = useActionState(analisarDocumentoAction, estadoInicial);

  const [comportamento, setComportamento] = useState("");
  const [fatos, setFatos] = useState<Fato[]>([]);
  const [msgConfirm, setMsgConfirm] = useState<{ ok: boolean; texto: string } | null>(null);
  const [salvando, iniciarSalvar] = useTransition();

  useEffect(() => {
    if (estado.ok && estado.preview) {
      setComportamento(estado.preview.behavior);
      setFatos(
        estado.preview.knowledge.map((f, i) => ({
          _key: `${i}-${f.title}`,
          title: f.title,
          content: f.content,
        })),
      );
      setMsgConfirm(null);
    }
  }, [estado]);

  function atualizarFato(idx: number, campo: keyof Fato, valor: string) {
    setFatos((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, [campo]: valor } : f)),
    );
  }

  function excluirFato(idx: number) {
    setFatos((prev) => prev.filter((_, i) => i !== idx));
  }

  function confirmar() {
    setMsgConfirm(null);
    iniciarSalvar(async () => {
      const knowledge = fatos.map(({ title, content }) => ({ title, content }));
      const res = await confirmarCerebroAction({ behavior: comportamento, knowledge });
      setMsgConfirm({ ok: res.ok, texto: res.message });
      if (res.ok) {
        setComportamento("");
        setFatos([]);
      }
    });
  }

  const temPreview = fatos.length > 0 || comportamento.trim().length > 0;

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="texto">Texto do cérebro</Label>
          <Textarea
            id="texto"
            name="texto"
            rows={10}
            placeholder="Cole aqui tudo sobre o agente: tom de voz, regras, serviços, preços, objeções..."
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="arquivo">Ou suba um arquivo (.md / .txt)</Label>
          <Input id="arquivo" name="arquivo" type="file" accept=".md,.txt" />
          <p className="text-xs text-muted-foreground">
            O agente divide o texto em comportamento (system prompt) e fatos consultáveis.
            Nada é salvo até você confirmar.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <BotaoAnalisar />
          {estado.message ? (
            <span
              className={cn(
                "text-sm",
                estado.ok ? "text-success" : "text-destructive",
              )}
            >
              {estado.message}
            </span>
          ) : null}
        </div>
      </form>

      {temPreview ? (
        <div className="space-y-5 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div>
            <h3 className="text-sm font-semibold">Pré-visualização</h3>
            <p className="text-xs text-muted-foreground">
              Revise e edite antes de salvar. Ao confirmar, o comportamento{" "}
              <strong>substitui</strong> o atual e os fatos com origem "cérebro" são
              regravados.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="preview-comportamento">Comportamento (system prompt)</Label>
            <Textarea
              id="preview-comportamento"
              rows={12}
              value={comportamento}
              onChange={(e) => setComportamento(e.target.value)}
              className="bg-background text-foreground font-mono text-xs"
              placeholder="Instruções de tom, regras e personalidade do agente..."
            />
          </div>

          <div className="space-y-3">
            <Label>Fatos ({fatos.length})</Label>
            {fatos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum fato identificado. Adicione manualmente ou verifique o documento.
              </p>
            ) : (
              fatos.map((fato, idx) => (
                <div
                  key={fato._key}
                  className="space-y-2 rounded-md border border-border bg-card p-3"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={fato.title}
                      onChange={(e) => atualizarFato(idx, "title", e.target.value)}
                      placeholder="Título do fato"
                      className="bg-background text-foreground"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => excluirFato(idx)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <Textarea
                    rows={4}
                    value={fato.content}
                    onChange={(e) => atualizarFato(idx, "content", e.target.value)}
                    placeholder="Conteúdo do fato"
                    className="bg-background text-foreground"
                  />
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button type="button" onClick={confirmar} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar no cérebro"}
            </Button>
            {msgConfirm ? (
              <span
                className={cn(
                  "text-sm",
                  msgConfirm.ok ? "text-success" : "text-destructive",
                )}
              >
                {msgConfirm.texto}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
