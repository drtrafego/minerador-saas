"use client";

import { useState, useTransition } from "react";
import {
  Calendar,
  Mail,
  MessageCircle,
  Phone,
  StickyNote,
  Users,
  CheckCircle2,
  Circle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  createActivity,
  toggleActivityComplete,
} from "@/app/(app)/pipeline/actions";
import type { ActivityRow } from "@/lib/db/queries/pipeline";
import { fmtDateTimeBR } from "@/lib/format-date";

const typeMeta = {
  note: { label: "Nota", icon: StickyNote },
  call: { label: "Ligacao", icon: Phone },
  email: { label: "Email", icon: Mail },
  meeting: { label: "Reuniao", icon: Users },
  whatsapp: { label: "WhatsApp", icon: MessageCircle },
  task: { label: "Tarefa", icon: Calendar },
} as const;

type ActivityType = keyof typeof typeMeta;

export function ActivityTimeline({
  leadId,
  activities,
}: {
  leadId: string;
  activities: ActivityRow[];
}) {
  const [type, setType] = useState<ActivityType>("note");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!title.trim()) {
      toast.error("titulo obrigatorio");
      return;
    }
    startTransition(async () => {
      try {
        await createActivity({
          leadId,
          type,
          title: title.trim(),
          description: description.trim() || undefined,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        });
        setTitle("");
        setDescription("");
        setDueAt("");
        toast.success("atividade criada");
      } catch (err) {
        toast.error("falha ao criar");
        console.error(err);
      }
    });
  }

  function toggle(activityId: string) {
    startTransition(async () => {
      try {
        await toggleActivityComplete({ activityId, leadId });
      } catch {
        toast.error("falha ao atualizar");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border p-3">
        <div className="flex flex-wrap gap-1">
          {(Object.keys(typeMeta) as ActivityType[]).map((k) => {
            const Icon = typeMeta[k].icon;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setType(k)}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${
                  type === k ? "border-ring bg-secondary" : "border-input text-muted-foreground"
                }`}
              >
                <Icon className="h-3 w-3" />
                {typeMeta[k].label}
              </button>
            );
          })}
        </div>
        <Input
          placeholder="Titulo"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={pending}
        />
        <Textarea
          placeholder="Descricao (opcional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          disabled={pending}
        />
        <div className="flex items-center gap-2">
          <Input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            disabled={pending}
            className="max-w-xs"
          />
          <Button size="sm" onClick={submit} disabled={pending || !title.trim()}>
            Adicionar
          </Button>
        </div>
      </div>

      <ol className="relative border-l pl-4">
        {activities.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Nenhuma atividade ainda.</p>
        ) : null}
        {activities.map((a) => {
          const meta = typeMeta[a.type as ActivityType] ?? typeMeta.note;
          const Icon = meta.icon;
          const done = !!a.completedAt;
          return (
            <li key={a.id} className="mb-4 ml-2">
              <span className="absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full bg-background">
                <Icon className="h-3 w-3" />
              </span>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase text-muted-foreground">{meta.label}</span>
                    {a.dueAt ? (
                      <span className="text-xs text-muted-foreground">
                        {fmtDateTimeBR(a.dueAt, {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    ) : null}
                  </div>
                  <p className={`text-sm font-medium ${done ? "line-through opacity-60" : ""}`}>
                    {a.title}
                  </p>
                  {a.description ? (
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {a.description}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    {fmtDateTimeBR(a.createdAt, {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                {a.type === "task" ? (
                  <button
                    type="button"
                    onClick={() => toggle(a.id)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={done ? "Desmarcar" : "Marcar feito"}
                  >
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : (
                      <Circle className="h-4 w-4" />
                    )}
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
