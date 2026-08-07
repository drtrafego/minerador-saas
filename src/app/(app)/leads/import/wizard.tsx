"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { parseCsv, type CsvRow } from "@/lib/csv";
import { importLeadsFromCsv } from "./actions";

type Field =
  | "displayName"
  | "handle"
  | "email"
  | "phone"
  | "website"
  | "city"
  | "region"
  | "country"
  | "linkedinUrl"
  | "headline"
  | "company";

const fields: Array<{ key: Field; label: string; required?: boolean }> = [
  { key: "displayName", label: "Nome", required: true },
  { key: "handle", label: "Handle / usuario" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Telefone" },
  { key: "website", label: "Website" },
  { key: "company", label: "Empresa" },
  { key: "headline", label: "Headline / cargo" },
  { key: "city", label: "Cidade" },
  { key: "region", label: "Estado" },
  { key: "country", label: "Pais" },
  { key: "linkedinUrl", label: "LinkedIn URL" },
];

const autoHints: Record<Field, string[]> = {
  displayName: ["name", "nome", "full_name", "fullname", "display_name"],
  handle: ["handle", "username", "user", "usuario"],
  email: ["email", "e-mail"],
  phone: ["phone", "telefone", "whatsapp", "celular"],
  website: ["website", "site", "url"],
  city: ["city", "cidade"],
  region: ["region", "state", "estado", "uf"],
  country: ["country", "pais"],
  linkedinUrl: ["linkedin", "linkedin_url", "linkedinurl"],
  headline: ["headline", "cargo", "title", "titulo"],
  company: ["company", "empresa", "companhia"],
};

function autoMap(headers: string[]): Partial<Record<Field, string>> {
  const map: Partial<Record<Field, string>> = {};
  for (const f of fields) {
    const hints = autoHints[f.key];
    const hit = headers.find((h) => hints.includes(h.toLowerCase().trim()));
    if (hit) map[f.key] = hit;
  }
  return map;
}

export function ImportWizard({
  campaigns,
}: {
  campaigns: Array<{ id: string; name: string }>;
}) {
  const [raw, setRaw] = useState("");
  const [mapping, setMapping] = useState<Partial<Record<Field, string>>>({});
  const [campaignId, setCampaignId] = useState<string>("");
  const [pending, start] = useTransition();

  const parsed = useMemo(() => {
    if (!raw.trim()) return { headers: [] as string[], rows: [] as CsvRow[] };
    try {
      return parseCsv(raw);
    } catch {
      return { headers: [] as string[], rows: [] as CsvRow[] };
    }
  }, [raw]);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setRaw(text);
      const p = parseCsv(text);
      setMapping(autoMap(p.headers));
    };
    reader.readAsText(file);
  }

  function onPaste(text: string) {
    setRaw(text);
    const p = parseCsv(text);
    setMapping(autoMap(p.headers));
  }

  function buildRows() {
    return parsed.rows.map((r) => {
      const row: Record<string, string | null> = {};
      for (const f of fields) {
        const h = mapping[f.key];
        row[f.key] = h ? r[h] || null : null;
      }
      return row;
    });
  }

  const canImport =
    parsed.rows.length > 0 && !!mapping.displayName && !pending;

  function submit() {
    const rows = buildRows().filter((r) => r.displayName && r.displayName.trim().length > 0);
    if (rows.length === 0) {
      toast.error("coluna Nome obrigatoria e sem linhas validas");
      return;
    }
    start(async () => {
      try {
        const r = await importLeadsFromCsv({
          campaignId: campaignId || undefined,
          rows: rows as Parameters<typeof importLeadsFromCsv>[0]["rows"],
        });
        toast.success(`importados ${r.inserted} de ${r.total}`);
        setRaw("");
        setMapping({});
      } catch (err) {
        console.error(err);
        toast.error("falha ao importar");
      }
    });
  }

  const preview = parsed.rows.slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border p-4">
        <h2 className="mb-2 text-sm font-semibold">1. CSV</h2>
        <div className="flex items-center gap-2">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="text-sm"
          />
          <span className="text-xs text-muted-foreground">ou cole abaixo</span>
        </div>
        <Textarea
          value={raw}
          onChange={(e) => onPaste(e.target.value)}
          placeholder="nome,email,telefone,cidade..."
          rows={6}
          className="mt-2 font-mono text-xs"
        />
        {parsed.headers.length > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {parsed.headers.length} colunas - {parsed.rows.length} linhas
          </p>
        ) : null}
      </div>

      {parsed.headers.length > 0 ? (
        <div className="rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-semibold">2. Mapear colunas</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  {f.label} {f.required ? <span className="text-destructive">*</span> : null}
                </label>
                <select
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                  value={mapping[f.key] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [f.key]: e.target.value || undefined }))
                  }
                >
                  <option value="">-</option>
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {preview.length > 0 ? (
        <div className="rounded-xl border p-4">
          <h2 className="mb-3 text-sm font-semibold">3. Preview</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left">
                  {fields.map((f) => (
                    <th key={f.key} className="px-2 py-1 font-medium">
                      {f.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, idx) => (
                  <tr key={idx} className="border-b">
                    {fields.map((f) => (
                      <td key={f.key} className="max-w-xs truncate px-2 py-1">
                        {mapping[f.key] ? r[mapping[f.key]!] : ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between rounded-xl border p-4">
        <div className="flex items-center gap-2">
          <label className="text-sm">Campanha (opcional)</label>
          <select
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
          >
            <option value="">sem campanha</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={submit} disabled={!canImport}>
          {pending ? "Importando..." : `Importar ${parsed.rows.length} leads`}
        </Button>
      </div>
    </div>
  );
}
