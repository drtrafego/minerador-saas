"use client";

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { MetaTemplate } from "@/lib/clients/meta-templates";
import { type VarSpec, LEAD_FIELDS } from "@/lib/utils/template-vars";

export type MetaTemplateValue = {
  name: string;
  lang: string;
  vars: VarSpec[];
  body: string;
};

// bg-background + text-foreground (nao bg-transparent): no dark mode o dropdown
// nativo abria branco com texto claro, ilegivel. As <option> tambem recebem cor
// explicita via [&>option] para o menu suspenso ficar legivel nos dois temas.
const selectClass =
  "mt-1 h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-xs outline-none transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-background [&>option]:text-foreground";

const varSelectClass =
  "h-9 shrink-0 rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-background [&>option]:text-foreground";

const defaultSpec: VarSpec = { kind: "field", value: LEAD_FIELDS[0].value };

function contarVariaveis(body: string): number {
  const re = /\{\{\s*(\d+)\s*\}\}/g;
  let maior = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const n = Number(m[1]);
    if (n > maior) maior = n;
  }
  return maior;
}

type Props = {
  available: boolean;
  error?: string;
  templates: MetaTemplate[];
  value: MetaTemplateValue | null;
  onChange: (next: MetaTemplateValue | null) => void;
};

export function MetaTemplatePicker({
  available,
  error,
  templates,
  value,
  onChange,
}: Props) {
  const selectedName = value?.name ?? "";

  const selected = useMemo(
    () => templates.find((t) => t.name === selectedName),
    [templates, selectedName],
  );

  const numVars = selected ? contarVariaveis(selected.body) : 0;
  const vars = value?.vars ?? [];
  const visibleVars = selected
    ? Array.from({ length: numVars }, (_, i) => vars[i] ?? defaultSpec)
    : [];

  function changeTemplate(name: string) {
    if (!name) {
      onChange(null);
      return;
    }
    const tpl = templates.find((t) => t.name === name);
    if (!tpl) {
      onChange(null);
      return;
    }
    const n = contarVariaveis(tpl.body);
    const nextVars = Array.from({ length: n }, (_, i) => vars[i] ?? defaultSpec);
    onChange({ name: tpl.name, lang: tpl.language || "pt_BR", vars: nextVars, body: tpl.body });
  }

  function updateVar(index: number, patch: Partial<VarSpec>) {
    if (!value || !selected) return;
    const next = Array.from({ length: numVars }, (_, i) => value.vars[i] ?? defaultSpec);
    const current = next[index] ?? defaultSpec;
    const merged: VarSpec = { kind: patch.kind ?? current.kind, value: patch.value ?? current.value };
    if (patch.kind && patch.kind !== current.kind) {
      merged.value = patch.kind === "field" ? LEAD_FIELDS[0].value : "";
    }
    next[index] = merged;
    onChange({ ...value, vars: next });
  }

  function renderVarRow(spec: VarSpec, index: number) {
    return (
      <div key={index} className="flex flex-wrap items-center gap-2">
        <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">
          {`Variável {{${index + 1}}}`}
        </span>
        <select
          value={spec.kind}
          onChange={(e) => updateVar(index, { kind: e.target.value as VarSpec["kind"] })}
          className={`w-36 ${varSelectClass}`}
        >
          <option value="field">Campo do lead</option>
          <option value="fixed">Texto fixo</option>
        </select>
        {spec.kind === "field" ? (
          <select
            value={spec.value}
            onChange={(e) => updateVar(index, { value: e.target.value })}
            className={`flex-1 ${varSelectClass}`}
          >
            {LEAD_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        ) : (
          <Input
            value={spec.value}
            onChange={(e) => updateVar(index, { value: e.target.value })}
            placeholder="Texto fixo (igual para todos os leads)"
            className="flex-1"
          />
        )}
      </div>
    );
  }

  if (!available) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
        {error
          ? `Não foi possível carregar os templates da Meta: ${error}`
          : "Configure o WhatsApp API em Configurações > Credenciais (Phone Number ID, Access Token e WABA ID) para escolher um template aprovado."}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-3">
      <div className="space-y-1">
        <Label htmlFor="metaTemplateSelect">Template aprovado da Meta</Label>
        <select
          id="metaTemplateSelect"
          value={selectedName}
          onChange={(e) => changeTemplate(e.target.value)}
          className={selectClass}
        >
          <option value="">(nenhum / usar texto livre)</option>
          {templates.map((t) => (
            <option key={`${t.name}-${t.language}`} value={t.name}>
              {`${t.name} (${t.status}, ${t.language})`}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Em abordagem fria por WhatsApp oficial, a Meta exige um template aprovado
          para a primeira mensagem (lead fora da janela de 24h). So templates com
          status APPROVED aparecem aqui.
        </p>
        {templates.length === 0 ? (
          <p className="text-xs text-warning">
            Nenhum template aprovado encontrado nesta conta WhatsApp Business.
          </p>
        ) : null}
      </div>

      {selected ? (
        <div className="space-y-3 rounded-md border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded bg-muted px-2 py-0.5 font-medium">
              {selected.status}
            </span>
            <span>{selected.language}</span>
            {selected.category ? <span>{selected.category}</span> : null}
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">
              Mensagem aprovada
            </div>
            <pre className="whitespace-pre-wrap rounded bg-muted/50 p-3 text-sm">
              {selected.body || "(sem corpo de texto)"}
            </pre>
          </div>
          {numVars > 0 ? (
            <div className="space-y-2">
              <Label className="text-xs">
                Variáveis do template (na ordem {"{{1}}"}, {"{{2}}"}...)
              </Label>
              <div className="space-y-2">
                {visibleVars.map((spec, index) => renderVarRow(spec, index))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Este template não tem variáveis. Nada a mapear.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
