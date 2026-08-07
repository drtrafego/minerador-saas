import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { outreachCampaigns } from "@/db/schema/outreach-campaigns";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
  instagram_dm: "Instagram",
  linkedin_dm: "LinkedIn",
};

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default async function OutreachPage() {
  const { organizationId } = await requireOrg();
  const rows = await db
    .select()
    .from(outreachCampaigns)
    .where(eq(outreachCampaigns.organizationId, organizationId))
    .orderBy(desc(outreachCampaigns.createdAt));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">
            Sequencias de abordagem por email, WhatsApp, Instagram e LinkedIn.
          </p>
        </div>
        <Button render={<Link href="/outreach/new">Nova campanha</Link>} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nenhuma campanha de abordagem</CardTitle>
            <CardDescription>
              Crie sua primeira campanha para abordar leads automaticamente.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button render={<Link href="/outreach/new">Criar campanha</Link>} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((c) => {
            const touches = Array.isArray(c.sequenceJson)
              ? c.sequenceJson.length
              : 0;
            const paused = !c.active || c.sendPaused;
            return (
              <Link key={c.id} href={`/outreach/${c.id}`} className="group">
                <Card className="h-full transition-shadow group-hover:shadow-md">
                  <CardHeader className="gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base group-hover:underline">
                        {c.name}
                      </CardTitle>
                      <Badge variant={paused ? "outline" : "default"}>
                        {paused ? "pausada" : "ativa"}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="font-normal">
                        {CHANNEL_LABEL[c.channel] ?? c.channel}
                      </Badge>
                      <span>
                        {touches} {touches === 1 ? "mensagem" : "mensagens"}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      Criada em {dateFmt.format(c.createdAt)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
