import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ThreadsByStatusItem } from "@/lib/dashboard/queries";

const STATUS_LABELS: Record<string, string> = {
  queued: "Na fila",
  active: "Ativas",
  awaiting_reply: "Aguardando resposta",
  replied: "Responderam",
  booked: "Agendaram",
  dead: "Mortas",
  finished: "Finalizadas",
  failed: "Falharam",
};

type Props = {
  items: ThreadsByStatusItem[];
};

export function StatusBreakdown({ items }: Props) {
  const sorted = [...items].sort((a, b) => b.count - a.count);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Threads por status</CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma thread no periodo.
          </p>
        ) : (
          <ul className="space-y-2">
            {sorted.map((item) => (
              <li
                key={item.status}
                className="flex items-center justify-between text-sm"
              >
                <Badge variant="outline">
                  {STATUS_LABELS[item.status] ?? item.status}
                </Badge>
                <span className="tabular-nums text-muted-foreground">
                  {item.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
