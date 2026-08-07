"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { salvarAutomationConfig, salvarChannelWarmup } from "./actions";

type SourceType = "google_places" | "instagram_hashtag" | "linkedin_search";

const SOURCE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: "google_places", label: "Google Maps" },
  { value: "instagram_hashtag", label: "Instagram (hashtag)" },
  { value: "linkedin_search", label: "LinkedIn (busca)" },
];

type Combo = { niche: string; city: string; sourceType: SourceType };

type RouteChannel = "whatsapp" | "email";
type NicheRoute = { niche: string; channel: RouteChannel; campaignId: string };

type RestanteCanal = {
  capDia: number;
  consumo: number;
  restante: number;
  custoEstimadoUsd: number;
};

type WarmupState = {
  enabled: boolean;
  startedAt: string;
  restante: RestanteCanal;
};

type Campaign = { id: string; name: string; channel: string };

type ConfigState = {
  miningEnabled: boolean;
  rotationCombos: Combo[];
  nicheRouting: NicheRoute[];
  dispatchMode: "auto" | "approval";
  whatsappCampaignId: string;
  emailCampaignId: string;
  blocklist: string[];
};

const selectClass =
  "mt-1 flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-background [&>option]:text-foreground";

export function AutomationForm({
  initial,
  warmup,
  campaigns,
}: {
  initial: ConfigState;
  warmup: { whatsapp: WarmupState; email: WarmupState };
  campaigns: { whatsapp: Campaign[]; email: Campaign[] };
}) {
  const [config, setConfig] = useState<ConfigState>(initial);
  const [blockDraft, setBlockDraft] = useState("");
  const [pending, start] = useTransition();

  function update<K extends keyof ConfigState>(key: K, value: ConfigState[K]) {
    setConfig((s) => ({ ...s, [key]: value }));
  }

  function addCombo() {
    update("rotationCombos", [
      ...config.rotationCombos,
      { niche: "", city: "", sourceType: "google_places" },
    ]);
  }

  function updateCombo(idx: number, patch: Partial<Combo>) {
    update(
      "rotationCombos",
      config.rotationCombos.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
    );
  }

  function removeCombo(idx: number) {
    update(
      "rotationCombos",
      config.rotationCombos.filter((_, i) => i !== idx),
    );
  }

  function addRoute() {
    update("nicheRouting", [
      ...config.nicheRouting,
      { niche: "", channel: "whatsapp", campaignId: "" },
    ]);
  }

  function updateRoute(idx: number, patch: Partial<NicheRoute>) {
    update(
      "nicheRouting",
      config.nicheRouting.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, ...patch };
        // Trocar de canal invalida a campanha escolhida (campanhas sao por canal).
        if (patch.channel && patch.channel !== r.channel) next.campaignId = "";
        return next;
      }),
    );
  }

  function removeRoute(idx: number) {
    update(
      "nicheRouting",
      config.nicheRouting.filter((_, i) => i !== idx),
    );
  }

  function addBlock() {
    const v = blockDraft.trim();
    if (!v) return;
    update("blocklist", [...config.blocklist, v]);
    setBlockDraft("");
  }

  function removeBlock(idx: number) {
    update(
      "blocklist",
      config.blocklist.filter((_, i) => i !== idx),
    );
  }

  function submitConfig() {
    const combos = config.rotationCombos.filter((c) => c.niche.trim());
    const routing = config.nicheRouting.filter(
      (r) => r.niche.trim() && r.campaignId,
    );
    start(async () => {
      try {
        await salvarAutomationConfig({
          miningEnabled: config.miningEnabled,
          rotationCombos: combos.map((c) => ({
            niche: c.niche.trim(),
            city: c.city.trim() || null,
            sourceType: c.sourceType,
          })),
          nicheRouting: routing.map((r) => ({
            niche: r.niche.trim(),
            channel: r.channel,
            campaignId: r.campaignId,
          })),
          dispatchMode: config.dispatchMode,
          whatsappCampaignId: config.whatsappCampaignId || null,
          emailCampaignId: config.emailCampaignId || null,
          blocklist: config.blocklist,
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
      <MineracaoCard
        miningEnabled={config.miningEnabled}
        combos={config.rotationCombos}
        onToggle={(v) => update("miningEnabled", v)}
        onAdd={addCombo}
        onUpdate={updateCombo}
        onRemove={removeCombo}
      />

      <RoteamentoCard
        routes={config.nicheRouting}
        campaigns={campaigns}
        onAdd={addRoute}
        onUpdate={updateRoute}
        onRemove={removeRoute}
      />

      <div className="rounded-xl border p-4 space-y-4">
        <div>
          <p className="text-sm font-medium">Aquecimento de envio</p>
          <p className="text-xs text-muted-foreground">
            O envio começa devagar e sobe aos poucos para proteger a reputação
            de cada canal. Ligue o aquecimento e defina a data de início.
          </p>
        </div>
        <WarmupBlock channel="whatsapp" label="WhatsApp" state={warmup.whatsapp} />
        <WarmupBlock channel="email" label="Email" state={warmup.email} />
      </div>

      <div className="rounded-xl border p-4 space-y-4">
        <div>
          <p className="text-sm font-medium">Disparo</p>
          <p className="text-xs text-muted-foreground">
            Escolha se o plano do dia sai sozinho ou espera a sua aprovação. As
            campanhas abaixo são um reserva: valem só para nichos que não
            estiverem no roteamento acima.
          </p>
        </div>

        <div className="space-y-2">
          <label className="flex items-start gap-3">
            <input
              type="radio"
              name="dispatchMode"
              className="mt-1"
              checked={config.dispatchMode === "approval"}
              onChange={() => update("dispatchMode", "approval")}
            />
            <span className="text-sm">
              <span className="font-medium">Com minha aprovação</span>
              <span className="block text-xs text-muted-foreground">
                Todo dia o sistema monta o plano e você aprova antes de enviar.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="radio"
              name="dispatchMode"
              className="mt-1"
              checked={config.dispatchMode === "auto"}
              onChange={() => update("dispatchMode", "auto")}
            />
            <span className="text-sm">
              <span className="font-medium">Automático total</span>
              <span className="block text-xs text-muted-foreground">
                O plano do dia é enviado sozinho, sem aprovação.
              </span>
            </span>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="whatsappCampaignId">Campanha reserva do WhatsApp</Label>
            <select
              id="whatsappCampaignId"
              value={config.whatsappCampaignId}
              onChange={(e) => update("whatsappCampaignId", e.target.value)}
              className={selectClass}
            >
              <option value="">Nenhuma</option>
              {campaigns.whatsapp.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="emailCampaignId">Campanha reserva do Email</Label>
            <select
              id="emailCampaignId"
              value={config.emailCampaignId}
              onChange={(e) => update("emailCampaignId", e.target.value)}
              className={selectClass}
            >
              <option value="">Nenhuma</option>
              {campaigns.email.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-4">
        <Label>Lista de bloqueio</Label>
        <p className="text-xs text-muted-foreground">
          Termos que não devem ser prospectados: nomes, telefones ou @ de
          clientes próprios. Quem bater entra já como não perturbar.
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            value={blockDraft}
            onChange={(e) => setBlockDraft(e.target.value)}
            placeholder="cliente proprio ltda"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addBlock();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addBlock}>
            Adicionar
          </Button>
        </div>
        {config.blocklist.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {config.blocklist.map((b, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs"
              >
                {b}
                <button
                  type="button"
                  onClick={() => removeBlock(i)}
                  aria-label="remover"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button onClick={submitConfig} disabled={pending}>
          {pending ? "Salvando..." : "Salvar configuração"}
        </Button>
      </div>
    </div>
  );
}

function MineracaoCard({
  miningEnabled,
  combos,
  onToggle,
  onAdd,
  onUpdate,
  onRemove,
}: {
  miningEnabled: boolean;
  combos: Combo[];
  onToggle: (v: boolean) => void;
  onAdd: () => void;
  onUpdate: (idx: number, patch: Partial<Combo>) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div className="rounded-xl border p-4 space-y-4">
      <div>
        <p className="text-sm font-medium">Mineração diária</p>
        <p className="text-xs text-muted-foreground">
          O sistema minera um combo por dia, rodando a lista em círculo. Defina
          nicho, cidade opcional e a origem.
        </p>
      </div>

      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={miningEnabled}
          onChange={(e) => onToggle(e.target.checked)}
        />
        <span className="text-sm font-medium">Mineração diária ativa</span>
      </label>

      <div className="space-y-2">
        {combos.map((c, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-40">
              <Label className="text-xs">Nicho</Label>
              <Input
                value={c.niche}
                onChange={(e) => onUpdate(i, { niche: e.target.value })}
                placeholder="restaurante turístico"
              />
            </div>
            <div className="flex-1 min-w-32">
              <Label className="text-xs">Cidade (opcional)</Label>
              <Input
                value={c.city}
                onChange={(e) => onUpdate(i, { city: e.target.value })}
                placeholder="Fortaleza"
              />
            </div>
            <div className="min-w-40">
              <Label className="text-xs">Origem</Label>
              <select
                value={c.sourceType}
                onChange={(e) =>
                  onUpdate(i, { sourceType: e.target.value as SourceType })
                }
                className={selectClass}
              >
                {SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(i)}
              aria-label="remover linha"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" onClick={onAdd}>
        Adicionar combo
      </Button>
    </div>
  );
}

function RoteamentoCard({
  routes,
  campaigns,
  onAdd,
  onUpdate,
  onRemove,
}: {
  routes: NicheRoute[];
  campaigns: { whatsapp: Campaign[]; email: Campaign[] };
  onAdd: () => void;
  onUpdate: (idx: number, patch: Partial<NicheRoute>) => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div className="rounded-xl border p-4 space-y-4">
      <div>
        <p className="text-sm font-medium">Roteamento por nicho</p>
        <p className="text-xs text-muted-foreground">
          Cada nicho sai por um canal com a sua própria mensagem. Ex.:
          restaurante por WhatsApp, advogado e clínica por email. O nome do
          nicho tem que bater com o da mineração.
        </p>
      </div>

      <div className="space-y-2">
        {routes.map((r, i) => {
          const opcoes = r.channel === "whatsapp" ? campaigns.whatsapp : campaigns.email;
          return (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-40">
                <Label className="text-xs">Nicho</Label>
                <Input
                  value={r.niche}
                  onChange={(e) => onUpdate(i, { niche: e.target.value })}
                  placeholder="advogado"
                />
              </div>
              <div className="min-w-36">
                <Label className="text-xs">Canal</Label>
                <select
                  value={r.channel}
                  onChange={(e) =>
                    onUpdate(i, { channel: e.target.value as RouteChannel })
                  }
                  className={selectClass}
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                </select>
              </div>
              <div className="flex-1 min-w-44">
                <Label className="text-xs">Campanha</Label>
                <select
                  value={r.campaignId}
                  onChange={(e) => onUpdate(i, { campaignId: e.target.value })}
                  className={selectClass}
                >
                  <option value="">Selecione</option>
                  {opcoes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemove(i)}
                aria-label="remover roteamento"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
      </div>

      <Button type="button" variant="outline" onClick={onAdd}>
        Adicionar nicho
      </Button>
    </div>
  );
}

function WarmupBlock({
  channel,
  label,
  state,
}: {
  channel: "whatsapp" | "email";
  label: string;
  state: WarmupState;
}) {
  const [enabled, setEnabled] = useState(state.enabled);
  const [startedAt, setStartedAt] = useState(state.startedAt);
  const [pending, start] = useTransition();
  const { capDia, consumo, restante, custoEstimadoUsd } = state.restante;

  function save() {
    start(async () => {
      try {
        await salvarChannelWarmup({ channel, enabled, startedAt });
        toast.success(`aquecimento ${label} salvo`);
      } catch (err) {
        console.error(err);
        toast.error("falha ao salvar aquecimento");
      }
    });
  }

  return (
    <div className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Aquecimento ativo
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label className="text-xs">Data de início</Label>
          <Input
            type="date"
            value={startedAt}
            onChange={(e) => setStartedAt(e.target.value)}
            className="w-40"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={save}
          disabled={pending}
        >
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Hoje o limite é {capDia}. Enviados: {consumo}. Restam: {restante}.
        {channel === "whatsapp"
          ? ` Custo estimado: US$${custoEstimadoUsd.toFixed(2)} de US$3.`
          : ""}
      </p>
    </div>
  );
}
