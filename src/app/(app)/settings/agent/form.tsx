"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { saveAgentConfig } from "./actions";

// Modelos disponíveis por finalidade.
// Gemini requer credencial Vertex (google_vertex) configurada em Configurações > Credenciais.
// Claude/OpenRouter requer credencial OpenRouter.
const ALL_MODELS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Vertex),rápido e barato" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Vertex),mais forte" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (OpenRouter),rápido e econômico" },
  { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (OpenRouter),equilibrado" },
  { value: "claude-opus-4-5", label: "Claude Opus 4.5 (OpenRouter),mais poderoso" },
];

// Para followUpModel e knowledgeModel (nullable): inclui opção vazia = automático.
const OPTIONAL_MODELS = [
  { value: "", label: "Automático (usa o default do provider)" },
  ...ALL_MODELS,
];

type FormState = {
  enabled: boolean;
  agentName: string;
  businessName: string;
  businessInfo: string;
  tone: string;
  systemPromptOverride: string;
  rules: string[];
  handoffKeywords: string[];
  maxAutoReplies: number;
  model: string;
  followUpModel: string;
  knowledgeModel: string;
  temperature: number;
};

export function AgentForm({ initial }: { initial: FormState }) {
  const [state, setState] = useState<FormState>(initial);
  const [ruleDraft, setRuleDraft] = useState("");
  const [kwDraft, setKwDraft] = useState("");
  const [pending, start] = useTransition();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function addRule() {
    const v = ruleDraft.trim();
    if (!v) return;
    update("rules", [...state.rules, v]);
    setRuleDraft("");
  }

  function removeRule(idx: number) {
    update(
      "rules",
      state.rules.filter((_, i) => i !== idx),
    );
  }

  function addKw() {
    const v = kwDraft.trim();
    if (!v) return;
    update("handoffKeywords", [...state.handoffKeywords, v]);
    setKwDraft("");
  }

  function removeKw(idx: number) {
    update(
      "handoffKeywords",
      state.handoffKeywords.filter((_, i) => i !== idx),
    );
  }

  function submit() {
    start(async () => {
      try {
        await saveAgentConfig({
          ...state,
          agentName: state.agentName.trim() || "Isabela",
          businessName: state.businessName.trim() || null,
          businessInfo: state.businessInfo.trim() || null,
          systemPromptOverride: state.systemPromptOverride.trim() || null,
          followUpModel: state.followUpModel.trim() || null,
          knowledgeModel: state.knowledgeModel.trim() || null,
        });
        toast.success("configuração salva");
      } catch (err) {
        console.error(err);
        toast.error("falha ao salvar");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border p-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => update("enabled", e.target.checked)}
          />
          <span className="text-sm font-medium">
            Agente ativo (responde automaticamente)
          </span>
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Mensagens inbound via WhatsApp (UazAPI ou Meta) são respondidas pelo
          Claude usando as regras abaixo.
        </p>
      </div>

      <div className="grid gap-4 rounded-xl border p-4 md:grid-cols-2">
        <div>
          <Label htmlFor="agentName">Nome da agente</Label>
          <Input
            id="agentName"
            value={state.agentName}
            onChange={(e) => update("agentName", e.target.value)}
            placeholder="Isabela"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Como a agente se identifica nas conversas. Padrão: Isabela.
          </p>
        </div>
        <div>
          <Label htmlFor="businessName">Nome do negócio</Label>
          <Input
            id="businessName"
            value={state.businessName}
            onChange={(e) => update("businessName", e.target.value)}
            placeholder="Casal do Tráfego"
          />
        </div>
        <div>
          <Label htmlFor="tone">Tom de voz</Label>
          <Input
            id="tone"
            value={state.tone}
            onChange={(e) => update("tone", e.target.value)}
            placeholder="profissional e direto"
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="businessInfo">Contexto do negócio</Label>
          <Textarea
            id="businessInfo"
            rows={6}
            value={state.businessInfo}
            onChange={(e) => update("businessInfo", e.target.value)}
            placeholder="O que vocês fazem, para quem, quais diferenciais, preços se aplicável, etc."
          />
        </div>
      </div>

      <div className="rounded-xl border p-4">
        <Label>Regras adicionais</Label>
        <div className="mt-2 flex gap-2">
          <Input
            value={ruleDraft}
            onChange={(e) => setRuleDraft(e.target.value)}
            placeholder="Não prometa retornos. Não cite concorrentes."
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addRule();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addRule}>
            Adicionar
          </Button>
        </div>
        {state.rules.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {state.rules.map((r, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-md border px-2 py-1 text-sm"
              >
                <span>{r}</span>
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  aria-label="remover"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="rounded-xl border p-4">
        <Label>Palavras-chave de handoff</Label>
        <p className="text-xs text-muted-foreground">
          Se o lead mandar uma dessas, o agente para de responder e marca a
          conversa como aguardando humano.
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            value={kwDraft}
            onChange={(e) => setKwDraft(e.target.value)}
            placeholder="humano"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addKw();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addKw}>
            Adicionar
          </Button>
        </div>
        {state.handoffKeywords.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {state.handoffKeywords.map((k, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs"
              >
                {k}
                <button type="button" onClick={() => removeKw(i)} aria-label="remover">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border p-4 space-y-4">
        <p className="text-sm font-medium">Modelos de IA por finalidade</p>
        <p className="text-xs text-muted-foreground">
          Gemini requer credencial Vertex configurada. Claude requer credencial OpenRouter.
          Cada finalidade usa o modelo específico aqui configurado; o modelo da credencial
          funciona apenas como fallback global.
        </p>

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="model">Agente conversacional (inbound)</Label>
            <select
              id="model"
              value={state.model}
              onChange={(e) => update("model", e.target.value)}
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-background [&>option]:text-foreground"
            >
              {ALL_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="followUpModel">Follow-up inteligente</Label>
            <select
              id="followUpModel"
              value={state.followUpModel}
              onChange={(e) => update("followUpModel", e.target.value)}
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-background [&>option]:text-foreground"
            >
              {OPTIONAL_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <Label htmlFor="knowledgeModel">RAG / treinamento de documentos</Label>
            <select
              id="knowledgeModel"
              value={state.knowledgeModel}
              onChange={(e) => update("knowledgeModel", e.target.value)}
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-background [&>option]:text-foreground"
            >
              {OPTIONAL_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="maxAutoReplies">Max respostas automáticas</Label>
            <Input
              id="maxAutoReplies"
              type="number"
              min={1}
              max={30}
              value={state.maxAutoReplies}
              onChange={(e) => update("maxAutoReplies", Number(e.target.value))}
            />
          </div>
          <div>
            <Label htmlFor="temperature">Temperatura (0 a 100)</Label>
            <Input
              id="temperature"
              type="number"
              min={0}
              max={100}
              value={state.temperature}
              onChange={(e) => update("temperature", Number(e.target.value))}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-4">
        <Label htmlFor="systemPromptOverride">
          System prompt manual (opcional)
        </Label>
        <p className="text-xs text-muted-foreground">
          Se preenchido com mais de 40 caracteres, substitui o prompt gerado
          pelas regras acima.
        </p>
        <Textarea
          id="systemPromptOverride"
          rows={8}
          value={state.systemPromptOverride}
          onChange={(e) => update("systemPromptOverride", e.target.value)}
          placeholder="Você é um agente de vendas que..."
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Salvando..." : "Salvar configuração"}
        </Button>
      </div>
    </div>
  );
}
