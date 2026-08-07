import { requireOrg } from "@/lib/auth/guards";
import { getOrgCredential, MissingCredentialError } from "@/lib/credentials/get";
import { listarTemplatesMeta } from "@/lib/clients/meta-templates";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  if (s === "APPROVED") {
    return (
      <Badge className="border border-success/30 bg-success/10 text-success hover:bg-success/10">
        Aprovado
      </Badge>
    );
  }
  if (s === "PENDING") {
    return (
      <Badge className="border border-warning/30 bg-warning/10 text-warning hover:bg-warning/10">
        Pendente
      </Badge>
    );
  }
  if (s === "REJECTED") {
    return (
      <Badge className="border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/10">
        Rejeitado
      </Badge>
    );
  }
  return <Badge variant="secondary">{status || "-"}</Badge>;
}

export default async function MensagensPage() {
  const { organizationId } = await requireOrg();

  // Lê a credencial do slot real "whatsapp_api" (snake_case, mesmo usado pelo webhook e envio)
  let cred: Awaited<ReturnType<typeof getOrgCredential<"whatsapp_api">>> | null = null;
  let credError: string | null = null;

  try {
    cred = await getOrgCredential(organizationId, "whatsapp_api");
  } catch (err) {
    if (err instanceof MissingCredentialError) {
      credError =
        "Credencial WhatsApp (Meta) nao configurada. Acesse Configuracoes > WhatsApp e preencha os campos Phone Number ID, Access Token, Verify Token e WABA ID.";
    } else {
      credError = `Erro ao carregar credencial: ${String(err)}`;
    }
  }

  if (credError || !cred) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          {credError ?? "Nao foi possivel carregar a credencial da Meta."}
        </div>
      </div>
    );
  }

  if (!cred.waba_id) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          O campo <strong>WABA ID</strong> (WhatsApp Business Account ID) nao
          esta configurado. Acesse Configuracoes &gt; WhatsApp, clique em
          Atualizar e preencha o campo WABA ID para habilitar a listagem de
          templates.
        </div>
      </div>
    );
  }

  // Mapeia snake_case do slot para camelCase esperado pelo cliente da Graph API
  const { ok, templates, error } = await listarTemplatesMeta({
    accessToken: cred.access_token,
    wabaId: cred.waba_id,
    graphVersion: cred.graph_version,
  });

  return (
    <div className="space-y-6">
      <PageHeader />

      {!ok ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
          {error ?? "Nao foi possivel carregar os templates da Meta."}
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Nenhum template encontrado nesta conta WhatsApp Business.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {templates.map((t) => (
            <Card key={`${t.name}-${t.language}`}>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <div className="space-y-1">
                  <CardTitle className="font-mono text-sm text-foreground">
                    {t.name}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{t.language || "-"}</span>
                    {t.category ? (
                      <Badge variant="secondary" className="font-normal">
                        {t.category}
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <StatusBadge status={t.status} />
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm text-foreground">
                  {t.body || "Sem corpo de texto."}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <h2 className="text-xl font-semibold text-foreground">
        Templates de Mensagem
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Templates aprovados da sua conta WhatsApp Business via Meta Cloud API.
        Use o nome do template no campo correspondente da campanha para disparos
        pelo canal oficial.
      </p>
    </div>
  );
}
