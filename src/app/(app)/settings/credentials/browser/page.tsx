import { requireOrg } from "@/lib/auth/guards";
import { getBrowserSessionStatus } from "@/lib/clients/browser/storage";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type StatusKind = "connected" | "needs_relogin" | "disconnected";

function statusLabel(kind: StatusKind): string {
  if (kind === "connected") return "Conectado";
  if (kind === "needs_relogin") return "Precisa religar";
  return "Desconectado";
}

function statusVariant(
  kind: StatusKind,
): "default" | "secondary" | "destructive" {
  if (kind === "connected") return "default";
  if (kind === "needs_relogin") return "destructive";
  return "secondary";
}

function formatDate(value: Date | null): string {
  if (!value) return "nunca";
  return value.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export default async function BrowserCredentialsPage() {
  const { organizationId } = await requireOrg();

  const [instagram, linkedin] = await Promise.all([
    getBrowserSessionStatus(organizationId, "instagram_session"),
    getBrowserSessionStatus(organizationId, "linkedin_session"),
  ]);

  const providers: Array<{
    key: "instagram" | "linkedin";
    title: string;
    description: string;
    session: Awaited<ReturnType<typeof getBrowserSessionStatus>>;
    loginCommand: string;
  }> = [
    {
      key: "instagram",
      title: "Instagram",
      description:
        "Sessão usada pra enviar DMs. Login manual é armazenado criptografado.",
      session: instagram,
      loginCommand: `pnpm browser:login --provider instagram --org ${organizationId}`,
    },
    {
      key: "linkedin",
      title: "LinkedIn",
      description: "Sessão usada pra mensagens e conexões no LinkedIn.",
      session: linkedin,
      loginCommand: `pnpm browser:login --provider linkedin --org ${organizationId}`,
    },
  ];

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Navegador</h1>
        <p className="text-sm text-muted-foreground">
          Sessões de navegador usadas por Instagram e LinkedIn. Conecte via
          terminal.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organization ID</CardTitle>
          <CardDescription>
            Use este valor nos comandos de login. Clique pra copiar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <code className="block select-all rounded bg-muted px-3 py-2 font-mono text-sm break-all">
            {organizationId}
          </code>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {providers.map((provider) => {
          let kind: StatusKind = "disconnected";
          if (provider.session) {
            kind = provider.session.needsRelogin
              ? "needs_relogin"
              : "connected";
          }
          return (
            <Card key={provider.key}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{provider.title}</CardTitle>
                  <Badge variant={statusVariant(kind)}>
                    {statusLabel(kind)}
                  </Badge>
                </div>
                <CardDescription>{provider.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="space-y-1">
                  <p className="text-muted-foreground">Perfil</p>
                  <p className="font-medium">
                    {provider.session?.profileUsername ?? "não conectado"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Último login</p>
                  <p className="font-medium">
                    {formatDate(provider.session?.savedAt ?? null)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">
                    Como conectar (rodar no terminal do servidor)
                  </p>
                  <code className="block select-all rounded bg-muted px-3 py-2 font-mono text-xs break-all">
                    {provider.loginCommand}
                  </code>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
