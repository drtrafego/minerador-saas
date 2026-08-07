"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SendsPerDayItem } from "@/lib/dashboard/queries";

type Props = {
  data: SendsPerDayItem[];
};

export function SendsPerDay({ data }: Props) {
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Envios nos ultimos 14 dias</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Sem envios registrados.
          </p>
        ) : (
          <div className="flex h-28 items-end gap-1">
            {data.map((item) => {
              const height = Math.max(2, (item.count / max) * 100);
              return (
                <div
                  key={item.day}
                  className="flex flex-1 flex-col items-center gap-1"
                  title={`${item.day}, ${item.count} envios`}
                >
                  <div
                    className="w-full rounded-t bg-primary/70"
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-[9px] text-muted-foreground">
                    {item.day.slice(5)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
