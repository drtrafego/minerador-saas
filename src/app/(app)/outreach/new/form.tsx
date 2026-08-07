"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createOutreachCampaign } from "../actions";
import {
  SequenceEditor,
  emptyTouch,
  type TouchDraft,
} from "../_components/sequence-editor";
import { TemplateVariables } from "../_components/template-variables";
import {
  MetaTemplatePicker,
  type MetaTemplateValue,
} from "../_components/meta-template-picker";
import type { MetaTemplate } from "@/lib/clients/meta-templates";

const CHANNELS = [
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "instagram_dm", label: "Instagram" },
  { value: "linkedin_dm", label: "LinkedIn" },
] as const;

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background text-foreground px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&>option]:bg-background [&>option]:text-foreground";

// Converte um template Meta preenchido num texto legivel (ex: "Ola {{primeiro_nome}}
// tudo bem? Sou da..."), usado como mensagem inicial quando o canal e WhatsApp com
// template e o usuario nao escreveu nada na sequencia.
export function bodyFromTemplate(mt: MetaTemplateValue): string {
  return mt.body
    .replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => {
      const spec = mt.vars[Number(n) - 1];
      if (!spec) return "";
      return spec.kind === "field" ? `{{${spec.value}}}` : spec.value;
    })
    .trim();
}

type Props = {
  templates: MetaTemplate[];
  templatesAvailable: boolean;
  templatesError?: string;
};

export function NewOutreachForm({
  templates,
  templatesAvailable,
  templatesError,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<string>("email");
  const [touches, setTouches] = useState<TouchDraft[]>([emptyTouch(true)]);
  const [metaTemplate, setMetaTemplate] = useState<MetaTemplateValue | null>(null);

  function submit() {
    if (!name.trim()) {
      toast.error("informe o nome da campanha");
      return;
    }
    let cleaned = touches.filter((t) => t.body.trim().length > 0);
    const usaTemplate = channel === "whatsapp" && metaTemplate;
    // No WhatsApp com template, a mensagem enviada e o proprio template. Se o
    // usuario nao escreveu nada na sequencia, geramos a mensagem inicial a partir
    // do template (para nao obrigar a reescrever a mensagem duas vezes).
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
      const res = await createOutreachCampaign({
        name,
        channel: channel as "email" | "whatsapp" | "instagram_dm" | "linkedin_dm",
        sequenceJson: cleaned.map((t, i) => ({
          delayDays: i === 0 ? 0 : t.delayDays,
          subject: t.subject.trim() || undefined,
          body: t.body,
        })),
        metaTemplate: channel === "whatsapp" ? metaTemplate : null,
      });
      if ("error" in res && res.error) {
        toast.error("falha ao criar campanha");
        console.error(res.error);
        return;
      }
      if ("id" in res && res.id) {
        toast.success("campanha criada");
        router.push(`/outreach/${res.id}`);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuração</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="name">Nome da campanha</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Clínicas São Paulo Q2"
          />
        </div>

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

        <div className="flex justify-end pt-2">
          <Button onClick={submit} disabled={pending}>
            {pending ? "Criando..." : "Criar campanha"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
