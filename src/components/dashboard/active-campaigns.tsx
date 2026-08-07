import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActiveCampaignItem } from "@/lib/dashboard/queries";

type Props = {
  items: ActiveCampaignItem[];
};

export function ActiveCampaigns({ items }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Campanhas ativas</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nenhuma campanha ativa no momento.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead className="text-right">Leads</TableHead>
                <TableHead className="text-right">Contatados</TableHead>
                <TableHead className="text-right">Respostas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link
                      href={`/mining/${item.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {item.name}
                    </Link>
                    {item.niche ? (
                      <p className="text-xs text-muted-foreground">
                        {item.niche}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.totalLeads}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.contactedLeads}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.repliedLeads}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
