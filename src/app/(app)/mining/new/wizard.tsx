"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IcpBuilder } from "./icp-builder";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  createAndStartMining,
  type CreateMiningInput,
} from "../actions";

type SourceType = "google_places" | "instagram_hashtag" | "linkedin_search";

const MODELS = [
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Vertex),rápido e barato" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Vertex),mais forte" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 (OpenRouter),rápido e econômico" },
  { value: "claude-sonnet-4-5", label: "Claude Sonnet 4.5 (OpenRouter),equilibrado (recomendado)" },
  { value: "claude-opus-4-5", label: "Claude Opus 4.5 (OpenRouter),mais poderoso" },
] as const;

type State = {
  step: 1 | 2 | 3;
  name: string;
  niche: string;
  activeSources: SourceType[];
  googleQuery: string;
  googleLocation: string;
  googleRadius: string;
  googleMaxResults: string;
  igSearch: string;
  igLocation: string;
  igMaxResults: string;
  igOnlyBrazil: boolean;
  linkedinQuery: string;
  linkedinLocation: string;
  linkedinMaxResults: string;
  prompt: string;
  model: string;
};

const DEFAULT_PROMPT = (niche: string) =>
  [
    `Você avalia se este lead é ideal para o nicho "${niche || "[nicho]"}".`,
    "",
    "ICP:",
    "- empresa ou perfil ativo nos últimos 90 dias",
    "- demonstra interesse real pelo segmento",
    "- tem indícios de capacidade de compra",
    "",
    "Para cada lead retorne:",
    "- decision: approved (encaixa no ICP) ou rejected",
    "- score: 0-100",
    "- reason: breve justificativa em uma frase",
  ].join("\n");

export function MiningWizard() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>({
    step: 1,
    name: "",
    niche: "",
    activeSources: ["google_places"],
    googleQuery: "",
    googleLocation: "",
    googleRadius: "5000",
    googleMaxResults: "60",
    igSearch: "",
    igLocation: "Brasil",
    igMaxResults: "30",
    igOnlyBrazil: true,
    linkedinQuery: "",
    linkedinLocation: "Brazil",
    linkedinMaxResults: "50",
    prompt: "",
    model: "claude-sonnet-4-5",
  });

  function update<K extends keyof State>(key: K, value: State[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function toggleSource(source: SourceType, checked: boolean) {
    setState((s) => ({
      ...s,
      activeSources: checked
        ? [...s.activeSources, source]
        : s.activeSources.filter((x) => x !== source),
    }));
  }

  function next() {
    if (state.step === 1) {
      if (!state.name.trim()) {
        toast.error("preencha o nome da mineração");
        return;
      }
      if (state.activeSources.length === 0) {
        toast.error("selecione ao menos uma fonte");
        return;
      }
      setState((s) => ({ ...s, step: 2 }));
      return;
    }
    if (state.step === 2) {
      if (state.activeSources.includes("google_places") && !state.googleQuery.trim()) {
        toast.error("preencha a query do Google Maps");
        return;
      }
      if (state.activeSources.includes("instagram_hashtag") && !state.igSearch.trim()) {
        toast.error("preencha o termo de busca do Instagram");
        return;
      }
      if (state.activeSources.includes("linkedin_search") && !state.linkedinQuery.trim()) {
        toast.error("preencha a query do LinkedIn");
        return;
      }
      setState((s) => {
        const derivedNiche = s.googleQuery || s.igSearch || s.linkedinQuery;
        return {
          ...s,
          step: 3,
          niche: s.niche || derivedNiche,
          prompt: s.prompt || DEFAULT_PROMPT(derivedNiche),
        };
      });
      return;
    }
  }

  function back() {
    if (state.step > 1) {
      setState((s) => ({ ...s, step: (s.step - 1) as 1 | 2 | 3 }));
    }
  }

  function submit() {
    if (state.prompt.trim().length < 10) {
      toast.error("prompt muito curto");
      return;
    }

    const sources: CreateMiningInput["sources"] = [];

    if (state.activeSources.includes("google_places")) {
      // Uma cidade por linha. 1 cidade -> location; varias -> locations[].
      const cities = state.googleLocation
        .split("\n")
        .map((c) => c.trim())
        .filter(Boolean);
      sources.push({
        type: "google_places",
        query: state.googleQuery,
        location: cities.length === 1 ? cities[0] : undefined,
        locations: cities.length > 1 ? cities : undefined,
        radius: state.googleRadius ? Number(state.googleRadius) : undefined,
        maxResults: state.googleMaxResults ? Number(state.googleMaxResults) : undefined,
      });
    }
    if (state.activeSources.includes("instagram_hashtag")) {
      // Busca so o termo. Concatenar o pais ("advogado Brasil") restringia demais
      // (o actor casa por username/nome e quase nenhum perfil tem "Brasil" no nome)
      // -> voltava 0. Para focar BR, use termos naturalmente locais (ex: advogado sp).
      sources.push({
        type: "instagram_hashtag",
        search: state.igSearch,
        maxResults: state.igMaxResults ? Number(state.igMaxResults) : undefined,
        onlyBrazil: state.igOnlyBrazil,
      });
    }
    if (state.activeSources.includes("linkedin_search")) {
      sources.push({
        type: "linkedin_search",
        query: state.linkedinQuery,
        // Filtro de localizacao nativo do actor (locations: [...]).
        location: state.linkedinLocation.trim() || undefined,
        maxResults: state.linkedinMaxResults ? Number(state.linkedinMaxResults) : undefined,
      });
    }

    const input: CreateMiningInput = {
      name: state.name,
      niche: state.niche,
      qualificationPrompt: state.prompt,
      qualificationModel: state.model,
      sources,
    };

    startTransition(async () => {
      const res = await createAndStartMining(input);
      if ("error" in res && res.error) {
        toast.error("falha ao criar mineração");
        console.error(res.error);
        return;
      }
      if ("miningId" in res && res.miningId) {
        toast.success("mineração criada e iniciada");
        router.push(`/mining/${res.miningId}`);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passo {state.step} de 3</CardTitle>
        <CardDescription>
          {state.step === 1 && "Identifique a mineração"}
          {state.step === 2 && "Configure as fontes de leads"}
          {state.step === 3 && "Configure o agente de qualificação"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.step === 1 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome da mineração</Label>
              <Input
                id="name"
                value={state.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Ex: Restaurantes São Paulo Q2"
              />
            </div>
            <div className="space-y-2">
              <Label>Fontes de mineração</Label>
              <p className="text-xs text-muted-foreground">
                Selecione uma ou mais fontes simultâneas
              </p>
              <div className="flex flex-col gap-2">
                {(
                  [
                    { value: "google_places" as SourceType, label: "Google Maps" },
                    { value: "instagram_hashtag" as SourceType, label: "Instagram" },
                    { value: "linkedin_search" as SourceType, label: "LinkedIn" },
                  ] as const
                ).map(({ value, label }) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-input p-3 hover:border-ring"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={state.activeSources.includes(value)}
                      onChange={(e) => toggleSource(value, e.target.checked)}
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {state.step === 2 ? (
          <div className="space-y-6">
            {state.activeSources.includes("google_places") && (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-medium">Google Maps</p>
                <div className="space-y-2">
                  <Label htmlFor="googleQuery">Query de busca</Label>
                  <Input
                    id="googleQuery"
                    value={state.googleQuery}
                    onChange={(e) => update("googleQuery", e.target.value)}
                    placeholder="hamburgueria artesanal"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="googleLocation">Cidade(s), uma por linha</Label>
                  <Textarea
                    id="googleLocation"
                    value={state.googleLocation}
                    onChange={(e) => update("googleLocation", e.target.value)}
                    placeholder={"São Paulo, SP\nRio de Janeiro, RJ\nBelo Horizonte, MG"}
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground">
                    Uma cidade por linha. O Google Maps é por cidade (não existe
                    Brasil inteiro numa busca); liste as cidades e o sistema minera cada uma.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="googleRadius">Raio (metros)</Label>
                    <Input
                      id="googleRadius"
                      value={state.googleRadius}
                      onChange={(e) => update("googleRadius", e.target.value)}
                      type="number"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="googleMaxResults">Max por cidade</Label>
                    <Input
                      id="googleMaxResults"
                      value={state.googleMaxResults}
                      onChange={(e) => update("googleMaxResults", e.target.value)}
                      type="number"
                    />
                  </div>
                </div>
              </div>
            )}

            {state.activeSources.includes("instagram_hashtag") && (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-medium">Instagram</p>
                <div className="space-y-2">
                  <Label htmlFor="igSearch">Termo de busca</Label>
                  <Input
                    id="igSearch"
                    value={state.igSearch}
                    onChange={(e) => update("igSearch", e.target.value)}
                    placeholder="hamburgueria artesanal"
                  />
                </div>
                <label className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={state.igOnlyBrazil}
                    onChange={(e) => update("igOnlyBrazil", e.target.checked)}
                  />
                  <span className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Filtrar apenas Brasil
                    </span>
                    . O Instagram não filtra país sozinho. Ligado, descarta perfis de
                    fora do Brasil. Desligue para minerar outro país (ex: médico
                    Argentina) e use termos locais na busca.
                  </span>
                </label>
                <div className="space-y-2">
                  <Label htmlFor="igMaxResults">Max perfis</Label>
                  <Input
                    id="igMaxResults"
                    value={state.igMaxResults}
                    onChange={(e) => update("igMaxResults", e.target.value)}
                    type="number"
                  />
                </div>
              </div>
            )}

            {state.activeSources.includes("linkedin_search") && (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-medium">LinkedIn</p>
                <div className="space-y-2">
                  <Label htmlFor="linkedinQuery">Query de busca</Label>
                  <Input
                    id="linkedinQuery"
                    value={state.linkedinQuery}
                    onChange={(e) => update("linkedinQuery", e.target.value)}
                    placeholder="head of growth startup brasil"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use termos livres. Ex: cargo, segmento, região.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="linkedinLocation">Localização (país/cidade)</Label>
                  <Input
                    id="linkedinLocation"
                    value={state.linkedinLocation}
                    onChange={(e) => update("linkedinLocation", e.target.value)}
                    placeholder="Brazil"
                  />
                  <p className="text-xs text-muted-foreground">
                    Filtro nativo do LinkedIn. Use em inglês (ex: Brazil, São Paulo).
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="linkedinMaxResults">Max perfis</Label>
                  <Input
                    id="linkedinMaxResults"
                    value={state.linkedinMaxResults}
                    onChange={(e) => update("linkedinMaxResults", e.target.value)}
                    type="number"
                  />
                </div>
              </div>
            )}
          </div>
        ) : null}

        {state.step === 3 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="model">Modelo de IA</Label>
              <select
                id="model"
                value={state.model}
                onChange={(e) => update("model", e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-background [&>option]:text-foreground"
              >
                {MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <IcpBuilder
              onApply={(prompt, niche) =>
                setState((s) => ({ ...s, prompt, niche: niche || s.niche }))
              }
            />
            <div className="space-y-2">
              <Label htmlFor="prompt">
                Texto do ICP (gerado acima, editável)
              </Label>
              <Textarea
                id="prompt"
                value={state.prompt || DEFAULT_PROMPT(state.niche)}
                onChange={(e) => update("prompt", e.target.value)}
                rows={14}
              />
            </div>
          </div>
        ) : null}

        <div className="flex justify-between pt-4">
          <Button variant="outline" onClick={back} disabled={state.step === 1 || pending}>
            Voltar
          </Button>
          {state.step < 3 ? (
            <Button onClick={next} disabled={pending}>
              Próximo
            </Button>
          ) : (
            <Button onClick={submit} disabled={pending}>
              {pending ? "Criando..." : "Criar e começar"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
