"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { dispararLeadsParaOutreachCampaign } from "@/app/(app)/leads/actions";
import type { OutreachCampaignOption } from "./leads-rich-table";

const selectCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40";

const CANAL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  email: "Email",
  instagram_dm: "Instagram DM",
  linkedin_dm: "LinkedIn DM",
};

type DispararDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadIds: string[];
  outreachCampaigns: OutreachCampaignOption[];
  initialCampaignId?: string;
  onSuccess: () => void;
};

type ResultState = { ok: boolean; message: string } | null;

/**
 * Dialogo de disparo para uma campanha de abordagem existente.
 *
 * O canal nao e escolhido aqui: vem da campanha selecionada e e apenas exibido.
 * Os leads sao passados ja resolvidos (leadIds), e o disparo chama a action
 * dispararLeadsParaOutreachCampaign.
 */
export function DispararDialog({
  open,
  onOpenChange,
  leadIds,
  outreachCampaigns,
  initialCampaignId,
  onSuccess,
}: DispararDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DispararFormInner
          leadIds={leadIds}
          outreachCampaigns={outreachCampaigns}
          initialCampaignId={initialCampaignId}
          onSuccess={onSuccess}
        />
      </DialogContent>
    </Dialog>
  );
}

function DispararFormInner({
  leadIds,
  outreachCampaigns,
  initialCampaignId,
  onSuccess,
}: Omit<DispararDialogProps, "open" | "onOpenChange">) {
  const [campanhaId, setCampanhaId] = useState(
    initialCampaignId || outreachCampaigns[0]?.id || "",
  );
  const [state, setState] = useState<ResultState>(null);
  const [pending, startTransition] = useTransition();

  const qtd = leadIds.length;
  const selecionada = outreachCampaigns.find((c) => c.id === campanhaId) ?? null;
  const canalLabel = selecionada
    ? CANAL_LABEL[selecionada.channel] ?? selecionada.channel
    : "";

  function handleSubmit() {
    if (!campanhaId) {
      setState({ ok: false, message: "Selecione uma campanha de abordagem." });
      return;
    }
    startTransition(async () => {
      const result = await dispararLeadsParaOutreachCampaign({
        outreachCampaignId: campanhaId,
        leadIds,
      });
      setState({ ok: result.ok, message: result.message });
      if (result.ok) onSuccess();
    });
  }

  if (outreachCampaigns.length === 0) {
    return (
      <div className="space-y-4">
        <DialogHeader>
          <DialogTitle>Disparar abordagem</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Nenhuma campanha de abordagem ativa. Crie uma campanha em{" "}
          <span className="font-medium">Abordagem</span> antes de disparar.
        </p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>
            Fechar
          </DialogClose>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Disparar abordagem</DialogTitle>
      </DialogHeader>

      <div className="space-y-2">
        <Label>Campanha de abordagem</Label>
        <select
          value={campanhaId}
          onChange={(e) => setCampanhaId(e.target.value)}
          className={selectCls}
          aria-label="Campanha de abordagem"
        >
          {outreachCampaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {selecionada ? (
          <p className="text-xs text-muted-foreground">
            Canal desta campanha:{" "}
            <span className="font-medium text-foreground">{canalLabel}</span>
          </p>
        ) : null}
      </div>

      <p className="text-sm">
        Disparar <span className="font-semibold">{qtd}</span>{" "}
        {qtd === 1 ? "lead" : "leads"}
        {selecionada ? (
          <>
            {" "}
            para <span className="font-semibold">{selecionada.name}</span> via{" "}
            <span className="font-semibold">{canalLabel}</span>
          </>
        ) : null}
        .
      </p>

      {state?.message ? (
        <p className={`text-sm ${state.ok ? "text-success" : "text-destructive"}`}>
          {state.message}
        </p>
      ) : null}

      <DialogFooter>
        {state?.ok ? (
          <DialogClose render={<Button variant="outline" type="button" />}>
            Fechar
          </DialogClose>
        ) : (
          <>
            <DialogClose render={<Button variant="outline" type="button" />}>
              Cancelar
            </DialogClose>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={pending || qtd === 0}
            >
              {pending
                ? "Enfileirando..."
                : `Disparar ${qtd === 1 ? "1 lead" : `${qtd} leads`}`}
            </Button>
          </>
        )}
      </DialogFooter>
    </div>
  );
}
