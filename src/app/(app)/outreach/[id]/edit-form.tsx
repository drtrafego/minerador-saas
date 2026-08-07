"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  deleteOutreachCampaign,
  toggleOutreachCampaign,
  updateOutreachCampaign,
} from "../actions";
import { SequenceEditor, type TouchDraft } from "../_components/sequence-editor";
import { TemplateVariables } from "../_components/template-variables";
import {
  MetaTemplatePicker,
  type MetaTemplateValue,
} from "../_components/meta-template-picker";
import { bodyFromTemplate } from "../new/form";
import type { MetaTemplate } from "@/lib/clients/meta-templates";

type Channel = "email" | "whatsapp" | "instagram_dm" | "linkedin_dm";

const CHANNELS = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram_dm", label: "Instagram" },
  { value: "linkedin_dm", label: "LinkedIn" },
] as const;

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-background [&>option]:text-foreground";

type Initial = {
  id: string;
  name: string;
  channel: Channel;
  active: boolean;
  sendPaused: boolean;
  dailyCap: number;
  touches: TouchDraft[];
  metaTemplate: MetaTemplateValue | null;
};

type Props = {
  initial: Initial;
  templates: MetaTemplate[];
  templatesAvailable: boolean;
  templatesError?: string;
};

export function EditOutreachForm({
  initial,
  templates,
  templatesAvailable,
  templatesError,
}: Props) {
  const [pending, startTransition] = useTransition();
  const [toggling, startToggle] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(initial.name);
  const [channel, setChannel] = useState<string>(initial.channel);
  const [sendPaused, setSendPaused] = useState(initial.sendPaused);
  const [dailyCap, setDailyCap] = useState(String(initial.dailyCap));
  const [active, setActive] = useState(initial.active);
  const [touches, setTouches] = useState<TouchDraft[]>(initial.touches);
  const [metaTemplate, setMetaTemplate] = useState<MetaTemplateValue | null>(
    initial.metaTemplate,
  );

  function save() {
    if (!name.trim()) {
      toast.error("informe o nome da campanha");
      return;
    }
    let cleaned = touches.filter((t) => t.body.trim().length > 0);
    const usaTemplate = channel === "whatsapp" && metaTemplate;
    // WhatsApp com template: a mensagem enviada e o template. Se a sequencia
    // estiver vazia, geramos a mensagem inicial a partir do template.
    if (usaTemplate && cleaned.length === 0) {
      cleaned = [{ delayDays: 0, subject: "", body: bodyFromTemplate(metaTemplate) }];
    }
    if (cleaned.length === 0) {
      toast.error(
        usaTemplate
          ? "preencha as variaveis do template"
          : "adicione ao menos uma mensagem",
      );
      return;
    }

    startTransition(async () => {
      const res = await updateOutreachCampaign({
        id: initial.id,
        name,
        channel: channel as Channel,
        active,
        sendPaused,
        dailyCap: Number(dailyCap) || 1,
        sequenceJson: cleaned.map((t, i) => ({
          delayDays: i === 0 ? 0 : t.delayDays,
          subject: t.subject.trim() || undefined,
          body: t.body,
        })),
        metaTemplate: channel === "whatsapp" ? metaTemplate : null,
      });
      if ("error" in res && res.error) {
        toast.error("falha ao salvar");
        console.error(res.error);
        return;
      }
      toast.success("campanha atualizada");
    });
  }

  function handleDelete() {
    // Dois cliques: o primeiro pede confirmacao, o segundo exclui de vez.
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    startDelete(async () => {
      const res = await deleteOutreachCampaign(initial.id);
      // Em caso de sucesso a action redireciona para /outreach; so tratamos erro.
      if (res && "error" in res && res.error) {
        toast.error("falha ao excluir campanha");
        setConfirmDelete(false);
      }
    });
  }

  function toggle() {
    startToggle(async () => {
      const next = !active;
      const res = await toggleOutreachCampaign(initial.id, next);
      if ("error" in res && res.error) {
        toast.error("falha ao alterar status");
        return;
      }
      setActive(next);
      toast.success(next ? "campanha ativada" : "campanha pausada");
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Configuração</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant={active ? "default" : "outline"}>
            {active ? "ativa" : "pausada"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={toggle}
            disabled={toggling}
          >
            {active ? "Pausar" : "Ativar"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="name">Nome da campanha</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="channel">Canal</Label>
            <select
              id="channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className={selectClass}
            >
              {CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dailyCap">Cap diaria</Label>
            <Input
              id="dailyCap"
              type="number"
              min={1}
              value={dailyCap}
              onChange={(e) => setDailyCap(e.target.value)}
            />
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-input p-3 hover:border-ring">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-input"
            checked={sendPaused}
            onChange={(e) => setSendPaused(e.target.checked)}
          />
          <span className="space-y-1 text-sm">
            <span className="block font-medium">Pausar envios</span>
            <span className="block text-xs text-muted-foreground">
              Mantém a campanha ativa, mas segura o disparo de novas mensagens.
            </span>
          </span>
        </label>

        {channel === "whatsapp" ? (
          <MetaTemplatePicker
            available={templatesAvailable}
            error={templatesError}
            templates={templates}
            value={metaTemplate}
            onChange={setMetaTemplate}
          />
        ) : null}

        <TemplateVariables />

        <SequenceEditor
          channel={channel}
          value={touches}
          onChange={setTouches}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <div className="flex items-center gap-2">
            <Button
              variant={confirmDelete ? "destructive" : "outline"}
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting
                ? "Excluindo..."
                : confirmDelete
                  ? "Confirmar exclusão"
                  : "Excluir campanha"}
            </Button>
            {confirmDelete && !deleting ? (
              <Button
                variant="ghost"
                onClick={() => setConfirmDelete(false)}
              >
                Cancelar
              </Button>
            ) : null}
          </div>
          <Button onClick={save} disabled={pending}>
            {pending ? "Salvando..." : "Salvar alterações"}
          </Button>
        </div>
        {confirmDelete && !deleting ? (
          <p className="text-right text-xs text-destructive">
            Isso apaga a campanha e remove os leads dela desta campanha. Nao da para desfazer.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
