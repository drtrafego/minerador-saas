"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { TEMPLATE_VARIABLES } from "@/lib/utils/template-vars";

export function TemplateVariables() {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <p className="text-xs font-medium text-muted-foreground">
        Variaveis disponiveis (clique para copiar)
      </p>
      <div className="flex flex-wrap gap-2">
        {TEMPLATE_VARIABLES.map((v) => (
          <button
            key={v.token}
            type="button"
            onClick={() => copy(v.token)}
            className="group inline-flex items-center gap-1"
            title={v.label}
          >
            <Badge
              variant="secondary"
              className="cursor-pointer font-mono group-hover:bg-primary group-hover:text-primary-foreground"
            >
              {copied === v.token ? "copiado!" : v.token}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
