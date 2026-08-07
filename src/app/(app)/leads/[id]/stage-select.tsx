"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { moveLeadToStage } from "@/app/(app)/pipeline/actions";
import type { PipelineStageRow } from "@/lib/db/queries/pipeline";

export function LeadStageSelect({
  leadId,
  currentStageId,
  stages,
}: {
  leadId: string;
  currentStageId: string | null;
  stages: PipelineStageRow[];
}) {
  const [pending, startTransition] = useTransition();

  function onChange(stageId: string) {
    const target = stageId === "" ? null : stageId;
    startTransition(async () => {
      try {
        await moveLeadToStage({ leadId, stageId: target });
        toast.success("etapa atualizada");
      } catch {
        toast.error("falha ao atualizar");
      }
    });
  }

  return (
    <select
      className="w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
      value={currentStageId ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={pending}
    >
      <option value="">Sem etapa</option>
      {stages.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
