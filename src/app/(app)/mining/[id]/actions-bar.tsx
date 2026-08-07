"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  deleteMining,
  pauseMining,
  resumeMining,
  startMining,
} from "../actions";

export function MiningActions({
  miningId,
  status,
}: {
  miningId: string;
  status: "draft" | "active" | "paused" | "archived";
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const handlePause = () =>
    start(async () => {
      const r = await pauseMining(miningId);
      if ("error" in r && r.error) toast.error(r.error);
      else toast.success("mineracao pausada");
    });

  const handleResume = () =>
    start(async () => {
      const r = await resumeMining(miningId);
      if ("error" in r && r.error) toast.error(r.error);
      else toast.success("mineracao retomada");
    });

  const handleStart = () =>
    start(async () => {
      const r = await startMining(miningId);
      if ("error" in r && r.error) toast.error(r.error);
      else toast.success("mineracao iniciada");
    });

  // Re-executa a mesma mineracao (mesma config, nicho e ICP), buscando mais leads.
  // Leads ja existentes sao ignorados por dedup; so entram os novos.
  const handleRerun = () =>
    start(async () => {
      const r = await startMining(miningId);
      if ("error" in r && r.error) toast.error(r.error);
      else toast.success("minerando novamente, buscando novos leads");
    });

  const handleDelete = () => {
    if (!confirm("Apagar mineracao? Isto remove leads associados.")) return;
    start(async () => {
      try {
        await deleteMining(miningId);
      } catch {
        router.push("/mining");
      }
    });
  };

  return (
    <div className="flex gap-2">
      {status === "draft" ? (
        <Button onClick={handleStart} disabled={pending}>
          Iniciar
        </Button>
      ) : null}
      {status === "active" ? (
        <Button variant="outline" onClick={handlePause} disabled={pending}>
          Pausar
        </Button>
      ) : null}
      {status === "paused" ? (
        <Button onClick={handleResume} disabled={pending}>
          Retomar
        </Button>
      ) : null}
      {status === "active" || status === "paused" || status === "archived" ? (
        <Button variant="outline" onClick={handleRerun} disabled={pending}>
          Minerar novamente
        </Button>
      ) : null}
      <Button variant="destructive" onClick={handleDelete} disabled={pending}>
        Apagar
      </Button>
    </div>
  );
}
