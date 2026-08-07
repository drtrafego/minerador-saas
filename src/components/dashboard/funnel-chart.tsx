"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type FunnelItem = {
  label: string;
  value: number;
};

type Props = {
  data: FunnelItem[];
};

function percent(current: number, previous: number): string {
  if (previous <= 0) return "0%";
  const p = (current / previous) * 100;
  return `${p.toFixed(1)}%`;
}

export function FunnelChart({ data }: Props) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Funil de conversao</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.map((item, idx) => {
          const width = Math.max(4, (item.value / max) * 100);
          const previous = idx === 0 ? item.value : data[idx - 1]!.value;
          const conv = idx === 0 ? "100%" : percent(item.value, previous);
          return (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{item.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {item.value.toLocaleString("pt-BR")}
                </span>
              </div>
              <div className="h-6 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full rounded bg-primary/80 transition-all"
                  style={{ width: `${width}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {idx === 0 ? "base" : `conversao, ${conv}`}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
