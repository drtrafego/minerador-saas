// Variaveis amigaveis disponiveis nos templates de abordagem.
// Cada token mapeia para um campo do lead (ver src/db/schema/leads.ts).
export const TEMPLATE_VARIABLES = [
  { token: "{{primeiro_nome}}", label: "Primeiro nome", key: "primeiro_nome" },
  { token: "{{nome}}", label: "Nome completo", key: "nome" },
  { token: "{{cidade}}", label: "Cidade", key: "cidade" },
  { token: "{{empresa}}", label: "Empresa", key: "empresa" },
  { token: "{{email}}", label: "Email", key: "email" },
  { token: "{{telefone}}", label: "Telefone", key: "telefone" },
  { token: "{{site}}", label: "Site", key: "site" },
] as const;

export type LeadVarSource = {
  displayName?: string | null;
  city?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
};

// Extrai o primeiro nome do nome completo (ex: "Joao Estrela" -> "Joao").
// Ignora titulos comuns (Dr, Dra) para nao virar "Dr" como primeiro nome.
export function firstNameOf(full?: string | null): string {
  const tokens = (full ?? "").trim().split(/\s+/).filter(Boolean);
  const skip = new Set(["dr", "dr.", "dra", "dra.", "sr", "sr.", "sra", "sra."]);
  const first = tokens.find((t) => !skip.has(t.toLowerCase())) ?? tokens[0] ?? "";
  return first;
}

export function buildLeadVars(lead: LeadVarSource): Record<string, string> {
  return {
    primeiro_nome: firstNameOf(lead.displayName),
    nome: lead.displayName ?? "",
    cidade: lead.city ?? "",
    empresa: lead.company ?? "",
    email: lead.email ?? "",
    telefone: lead.phone ?? "",
    site: lead.website ?? "",
  };
}

// Mapeamento de uma variavel {{n}} de um template aprovado da Meta:
// "field" usa um campo do lead, "fixed" usa um texto igual para todos.
export type VarSpec = { kind: "field" | "fixed"; value: string };

// Campos do lead disponiveis para preencher variaveis de template (value bate
// com as chaves de buildLeadVars).
export const LEAD_FIELDS = [
  { value: "primeiro_nome", label: "Primeiro nome" },
  { value: "nome", label: "Nome completo" },
  { value: "cidade", label: "Cidade" },
  { value: "empresa", label: "Empresa" },
  { value: "email", label: "Email" },
  { value: "telefone", label: "Telefone" },
  { value: "site", label: "Site" },
] as const;

const VALID_FIELD_VALUES = new Set<string>(LEAD_FIELDS.map((f) => f.value));
const DEFAULT_FIELD = LEAD_FIELDS[0].value;

export function parseTemplateVars(raw: string | null | undefined): VarSpec[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item): VarSpec => {
      if (
        item &&
        typeof item === "object" &&
        "kind" in item &&
        "value" in item &&
        (item.kind === "field" || item.kind === "fixed") &&
        typeof (item as { value: unknown }).value === "string"
      ) {
        const spec = item as VarSpec;
        if (spec.kind === "field" && !VALID_FIELD_VALUES.has(spec.value)) {
          return { kind: "field", value: DEFAULT_FIELD };
        }
        return { kind: spec.kind, value: spec.value };
      }
      return { kind: "field", value: DEFAULT_FIELD };
    });
  } catch {
    return [];
  }
}

export function serializeTemplateVars(vars: VarSpec[]): string {
  return JSON.stringify(vars);
}

// Resolve os parametros do corpo de um template ({{1}},{{2}}...) na ordem das
// specs, usando os valores reais do lead (ou o texto fixo).
export function resolveTemplateBodyParams(
  specs: VarSpec[],
  leadVars: Record<string, string>,
): string[] {
  return specs.map((s) => (s.kind === "fixed" ? s.value : leadVars[s.value] ?? ""));
}

// Substitui {{1}},{{2}}... no corpo aprovado pelos parametros resolvidos.
export function renderTemplateBody(body: string, bodyParams: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
    const idx = Number(n) - 1;
    return bodyParams[idx] ?? "";
  });
}

// Lead ficticio usado no preview do editor de sequencia.
export const SAMPLE_LEAD_VARS: Record<string, string> = {
  primeiro_nome: "Joao",
  nome: "Joao Silva",
  cidade: "Sao Paulo",
  empresa: "Clinica Vida",
  email: "joao@clinicavida.com.br",
  telefone: "(11) 99999-0000",
  site: "clinicavida.com.br",
};
