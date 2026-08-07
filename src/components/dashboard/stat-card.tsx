import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  label: string;
  value: number | string;
  subtitle?: string;
  icon?: LucideIcon;
  /** Destaca o card com o acento da marca (para a métrica principal). */
  accent?: boolean;
};

export function StatCard({ label, value, subtitle, icon: Icon, accent }: Props) {
  return (
    <Card className={cn("gap-0 py-4", accent && "border-primary/30 bg-primary/[0.03]")}>
      <CardContent className="px-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {Icon ? (
            <Icon
              className={cn(
                "h-4 w-4 shrink-0",
                accent ? "text-primary" : "text-muted-foreground/60",
              )}
            />
          ) : null}
        </div>
        <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">
          {value}
        </p>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
