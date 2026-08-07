import { Flame, Snowflake, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Temperature = "cold" | "warm" | "hot" | null;

const styles: Record<Exclude<Temperature, null>, { label: string; icon: typeof Flame; cls: string }> = {
  cold: {
    label: "Cold",
    icon: Snowflake,
    cls: "bg-info/10 text-info border-info/30",
  },
  warm: {
    label: "Warm",
    icon: Sun,
    cls: "bg-warning/10 text-warning border-warning/30",
  },
  hot: {
    label: "Hot",
    icon: Flame,
    cls: "bg-destructive/10 text-destructive border-destructive/30",
  },
};

export function TemperatureBadge({
  temperature,
  score,
  compact,
}: {
  temperature: Temperature;
  score?: number | null;
  compact?: boolean;
}) {
  const resolved: Temperature = temperature ?? deriveFromScore(score);
  if (!resolved) return null;
  const { label, icon: Icon, cls } = styles[resolved];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        cls,
      )}
    >
      <Icon className="h-3 w-3" />
      {!compact ? label : null}
    </span>
  );
}

function deriveFromScore(score: number | null | undefined): Temperature {
  if (score == null) return null;
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}
