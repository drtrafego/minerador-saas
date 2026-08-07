"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { renderTemplate } from "@/lib/utils/template";
import { SAMPLE_LEAD_VARS } from "@/lib/utils/template-vars";

export type TouchDraft = {
  delayDays: number;
  subject: string;
  body: string;
};

export function emptyTouch(first: boolean): TouchDraft {
  return { delayDays: first ? 0 : 1, subject: "", body: "" };
}

type Props = {
  channel: string;
  value: TouchDraft[];
  onChange: (next: TouchDraft[]) => void;
};

export function SequenceEditor({ channel, value, onChange }: Props) {
  const isEmail = channel === "email";
  const [preview, setPreview] = useState<number | null>(null);

  function update(index: number, patch: Partial<TouchDraft>) {
    onChange(value.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function add() {
    onChange([...value, emptyTouch(value.length === 0)]);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Mensagens da campanha</Label>
        <p className="text-xs text-muted-foreground">
          A mensagem inicial e enviada assim que o lead entra na campanha. Se
          quiser, adicione follow ups: reenvios automaticos disparados alguns dias
          depois, caso o lead nao responda (param assim que ele responde). Para uma
          campanha de uma mensagem so, deixe apenas a inicial.
        </p>
      </div>

      {value.length === 0 ? (
        <p className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground">
          Nenhuma mensagem ainda. Adicione a inicial.
        </p>
      ) : (
        <div className="space-y-4">
          {value.map((touch, index) => (
            <div
              key={index}
              className="space-y-3 rounded-md border bg-muted/30 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {index === 0 ? "Mensagem inicial" : `Follow-up ${index}`}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(index)}
                >
                  Remover
                </Button>
              </div>

              {index === 0 ? (
                <p className="text-xs text-muted-foreground">Envio: imediato</p>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor={`delay-${index}`} className="text-xs">
                    Enviar quantos dias apos a mensagem anterior
                  </Label>
                  <Input
                    id={`delay-${index}`}
                    type="number"
                    min={0}
                    value={touch.delayDays}
                    onChange={(e) =>
                      update(index, {
                        delayDays: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                  />
                </div>
              )}

              {isEmail ? (
                <div className="space-y-1">
                  <Label htmlFor={`subject-${index}`} className="text-xs">
                    Assunto
                  </Label>
                  <Input
                    id={`subject-${index}`}
                    value={touch.subject}
                    onChange={(e) => update(index, { subject: e.target.value })}
                    placeholder="Ex: vi a {{empresa}} aqui em {{cidade}}"
                  />
                </div>
              ) : null}

              <div className="space-y-1">
                <Label htmlFor={`body-${index}`} className="text-xs">
                  Mensagem
                </Label>
                <Textarea
                  id={`body-${index}`}
                  rows={isEmail ? 6 : 4}
                  value={touch.body}
                  onChange={(e) => update(index, { body: e.target.value })}
                  placeholder="Oi {{nome}}, tudo bem? ..."
                />
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setPreview((p) => (p === index ? null : index))
                }
              >
                {preview === index ? "Ocultar preview" : "Ver preview"}
              </Button>

              {preview === index ? (
                <div className="space-y-1 rounded border bg-background p-3 text-sm">
                  {isEmail && touch.subject ? (
                    <p className="font-medium">
                      {renderTemplate(touch.subject, SAMPLE_LEAD_VARS)}
                    </p>
                  ) : null}
                  <p className="whitespace-pre-wrap text-muted-foreground">
                    {renderTemplate(touch.body, SAMPLE_LEAD_VARS) ||
                      "Escreva a mensagem para ver o preview."}
                  </p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <Button type="button" variant="outline" size="sm" onClick={add}>
        {value.length === 0 ? "Adicionar mensagem" : "Adicionar follow-up"}
      </Button>
    </div>
  );
}
