"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { TemperatureBadge } from "@/components/temperature-badge";
import { moveLeadToStage } from "@/app/(app)/pipeline/actions";
import type { PipelineLeadCard, PipelineStageRow, LeadChannelOutreach } from "@/lib/db/queries/pipeline";

const CHANNEL_SHORT: Record<LeadChannelOutreach["channel"], string> = {
  whatsapp: "WA",
  email: "Email",
  instagram_dm: "IG",
  linkedin_dm: "LI",
};

type Props = {
  stages: PipelineStageRow[];
  leads: PipelineLeadCard[];
};

export function KanbanBoard({ stages, leads }: Props) {
  const [items, setItems] = useState(leads);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const byStage = useMemo(() => {
    const map = new Map<string | "unassigned", PipelineLeadCard[]>();
    map.set("unassigned", []);
    for (const stage of stages) map.set(stage.id, []);
    for (const lead of items) {
      const key = lead.pipelineStageId ?? "unassigned";
      if (!map.has(key)) map.set("unassigned", (map.get("unassigned") ?? []).concat(lead));
      else map.get(key)!.push(lead);
    }
    return map;
  }, [items, stages]);

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const leadId = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const target = overId === "unassigned" ? null : overId;

    const prev = items;
    setItems((cur) =>
      cur.map((l) => (l.id === leadId ? { ...l, pipelineStageId: target } : l)),
    );

    startTransition(async () => {
      try {
        await moveLeadToStage({ leadId, stageId: target });
      } catch (err) {
        setItems(prev);
        toast.error("Falha ao mover lead");
        console.error(err);
      }
    });
  }

  const active = activeId ? items.find((l) => l.id === activeId) : null;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-3">
        <Column
          key="unassigned"
          id="unassigned"
          title="Sem etapa"
          color="#94a3b8"
          leads={byStage.get("unassigned") ?? []}
        />
        {stages.map((s) => (
          <Column
            key={s.id}
            id={s.id}
            title={s.name}
            color={s.color}
            leads={byStage.get(s.id) ?? []}
          />
        ))}
      </div>
      <DragOverlay>
        {active ? (
          <div className="rotate-2">
            <LeadCard lead={active} dragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  id,
  title,
  color,
  leads,
}: {
  id: string;
  title: string;
  color: string;
  leads: PipelineLeadCard[];
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl border bg-muted/30">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        <span className="text-xs text-muted-foreground">{leads.length}</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex min-h-40 flex-1 flex-col gap-2 p-2 transition-colors ${
          isOver ? "bg-accent/50" : ""
        }`}
      >
        {leads.map((lead) => (
          <DraggableCard key={lead.id} lead={lead} />
        ))}
        {leads.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            arraste leads aqui
          </p>
        ) : null}
      </div>
    </div>
  );
}

function DraggableCard({ lead }: { lead: PipelineLeadCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`cursor-grab active:cursor-grabbing ${isDragging ? "opacity-40" : ""}`}
    >
      <LeadCard lead={lead} />
    </div>
  );
}

function stop(e: { stopPropagation: () => void }) {
  e.stopPropagation();
}

function LeadCard({ lead, dragging }: { lead: PipelineLeadCard; dragging?: boolean }) {
  return (
    <div
      className={`rounded-lg border bg-card p-3 shadow-sm ${
        dragging ? "shadow-lg" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/leads/${lead.id}`}
            onPointerDown={stop}
            onClick={stop}
            className="line-clamp-1 text-sm font-medium hover:underline"
          >
            {lead.displayName}
          </Link>
          {lead.phone ? (
            <a
              href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`}
              target="_blank"
              rel="noreferrer"
              onPointerDown={stop}
              onClick={stop}
              className="block truncate text-xs text-success hover:underline"
            >
              {lead.phone}
            </a>
          ) : null}
          {lead.email ? (
            <a
              href={`mailto:${lead.email}`}
              onPointerDown={stop}
              onClick={stop}
              className="block truncate text-[11px] text-muted-foreground hover:underline"
            >
              {lead.email}
            </a>
          ) : null}
        </div>
        <TemperatureBadge
          temperature={lead.temperature}
          score={lead.qualificationScore}
          compact
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
        {lead.company ? (
          <span className="rounded bg-success/10 px-1.5 py-0.5 text-success">
            {lead.company}
          </span>
        ) : null}
        {lead.city ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
            {lead.city}
          </span>
        ) : null}
        <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
          {lead.campaignName ?? lead.source}
        </span>
      </div>

      {lead.channelOutreach && lead.channelOutreach.some((c) => c.abordado) ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {lead.channelOutreach
            .filter((c) => c.abordado)
            .map((c) => (
              <Badge
                key={c.channel}
                variant={c.respondido ? "default" : "secondary"}
                className="text-[10px] px-1.5 py-0"
              >
                {CHANNEL_SHORT[c.channel]}
                {c.respondido ? " respondeu" : ""}
              </Badge>
            ))}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-3">
        <Link
          href={`/leads/${lead.id}`}
          onPointerDown={stop}
          onClick={stop}
          className="text-xs text-muted-foreground hover:underline"
        >
          ver lead
        </Link>
        {typeof lead.qualificationScore === "number" ? (
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            score {lead.qualificationScore}
          </span>
        ) : null}
      </div>
    </div>
  );
}
