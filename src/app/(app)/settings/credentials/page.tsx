import Link from "next/link";
import { desc, eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { credentials } from "@/db/schema/credentials";
import { requireOrg } from "@/lib/auth/guards";
import { getGmailPayload } from "@/lib/clients/gmail";
import { loadWhatsAppAPICredential } from "@/lib/clients/whatsapp-api";
import { loadUazAPICredential } from "@/lib/clients/whatsapp-uazapi";
import { getBrowserSessionStatus } from "@/lib/clients/browser/storage";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CredentialDialog } from "./credential-dialog";
import { DeleteCredentialButton } from "./delete-credential-button";
import { SetActiveCredentialButton } from "./set-active-credential-button";
import { GoogleOAuthConfigForm } from "./google-oauth-config-form";
import { GmailConnectButton } from "./gmail-connect";
import { BrevoForm } from "./brevo-form";
import { VertexForm } from "./vertex-form";
import { HermesForm } from "./hermes-form";
import { loadGoogleOAuthConfigStatus, loadBrevoStatus, loadVertexStatus, loadHermesStatus } from "./actions";

export default async function CredentialsPage({
  searchParams,
}: {
  searchParams: Promise<{ google_oauth?: string; google_oauth_error?: string }>;
}) {
  const { organizationId } = await requireOrg();
  const params = await searchParams;

  const [gmail, googleConfig, apiKeyRows, metaCred, uazapiCred, instagram, linkedin, brevo, vertex, hermes] =
    await Promise.all([
      getGmailPayload(organizationId),
      loadGoogleOAuthConfigStatus(),
      db
        .select({ id: credentials.id, provider: credentials.provider, label: credentials.label, isActive: credentials.isActive, createdAt: credentials.createdAt })
        .from(credentials)
        .where(and(
          eq(credentials.organizationId, organizationId),
          // somente chaves de API simples
        ))
        .orderBy(desc(credentials.createdAt)),
      loadWhatsAppAPICredential(organizationId),
      loadUazAPICredential(organizationId),
      getBrowserSessionStatus(organizationId, "instagram_session"),
      getBrowserSessionStatus(organizationId, "linkedin_session"),
      loadBrevoStatus(),
      loadVertexStatus(),
      loadHermesStatus(),
    ]);

  // Filtra so as API keys simples para a tabela
  const apiKeyProviders = ["openrouter", "apify", "google_places"];
  const apiKeyList = apiKeyRows.filter((r) => apiKeyProviders.includes(r.provider));

  // Descobre qual credencial esta EFETIVAMENTE em uso por provider: a marcada
  // como ativa, ou (se nenhuma marcada) a mais recente. Espelha a regra do
  // getOrgCredential (orderBy is_active desc, created_at desc). A lista ja vem
  // ordenada por createdAt desc, entao a primeira de cada provider e a recente.
  const effectiveActiveByProvider = new Map<string, string>();
  for (const row of apiKeyList) {
    if (row.isActive) effectiveActiveByProvider.set(row.provider, row.id);
  }
  for (const row of apiKeyList) {
    if (!effectiveActiveByProvider.has(row.provider)) {
      effectiveActiveByProvider.set(row.provider, row.id);
    }
  }

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Integrações</h1>
        <p className="text-sm text-muted-foreground">
          Conecte suas contas e serviços. Tudo criptografado no banco de dados.
        </p>
      </div>

      {params.google_oauth === "connected" && (
        <div className="rounded border border-success/40 bg-success/10 p-3 text-sm text-success">
          Gmail conectado com sucesso.
        </div>
      )}
      {params.google_oauth_error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          Falha ao conectar Gmail: {params.google_oauth_error}
        </div>
      )}

      {/* ── WhatsApp ─────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">WhatsApp</h2>
          <Link href="/settings/credentials/whatsapp" className={buttonVariants({ variant: "outline", size: "sm" })}>Gerenciar</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Meta WABA</CardTitle>
                <Badge variant={metaCred ? "default" : "secondary"} className="text-xs">
                  {metaCred ? "Configurado" : "Não configurado"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {metaCred
                ? `Phone ID: ${metaCred.cred.phone_number_id.slice(0, 6)}...`
                : "Clique em Gerenciar para conectar"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">UazAPI</CardTitle>
                <Badge variant={uazapiCred ? "default" : "secondary"} className="text-xs">
                  {uazapiCred ? "Configurado" : "Não configurado"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {uazapiCred
                ? uazapiCred.cred.base_url
                : "Clique em Gerenciar para conectar"}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Gmail ────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Gmail</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">1. Aplicativo Google (Client ID e Secret)</CardTitle>
            <CardDescription className="text-xs">
              Crie em console.cloud.google.com &gt; Credenciais &gt; ID do cliente OAuth 2.0
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GoogleOAuthConfigForm
              configured={googleConfig.configured}
              clientIdPreview={googleConfig.clientIdPreview}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">2. Conectar conta Gmail</CardTitle>
            <CardDescription className="text-xs">
              {googleConfig.configured
                ? "Clique para autorizar o acesso a sua conta Gmail."
                : "Configure o aplicativo Google acima primeiro."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GmailConnectButton connectedEmail={gmail?.payload.email ?? null} />
          </CardContent>
        </Card>
      </section>

      {/* ── Brevo (Email) ────────────────────────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Brevo (Email)</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Utilizado para disparos de email outreach. Configure a API Key e o remetente.
          </p>
        </div>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Configuração Brevo</CardTitle>
              <Badge variant={brevo.configured ? "default" : "secondary"} className="text-xs">
                {brevo.configured ? "Configurado" : "Não configurado"}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Crie sua API Key em app.brevo.com e informe o email remetente verificado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BrevoForm
              configured={brevo.configured}
              senderEmail={brevo.senderEmail}
              senderName={brevo.senderName}
              replyToEmail={brevo.replyToEmail}
            />
          </CardContent>
        </Card>
      </section>

      {/* ── Instagram e LinkedIn ─────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Instagram e LinkedIn</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Conectados via automação de navegador. Requer acesso ao servidor.
            </p>
          </div>
          <Link href="/settings/credentials/browser" className={buttonVariants({ variant: "outline", size: "sm" })}>Gerenciar</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Instagram</CardTitle>
                <Badge
                  variant={instagram ? (instagram.needsRelogin ? "destructive" : "default") : "secondary"}
                  className="text-xs"
                >
                  {instagram ? (instagram.needsRelogin ? "Precisa religar" : "Conectado") : "Desconectado"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {instagram?.profileUsername ?? "Clique em Gerenciar para ver instruções"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">LinkedIn</CardTitle>
                <Badge
                  variant={linkedin ? (linkedin.needsRelogin ? "destructive" : "default") : "secondary"}
                  className="text-xs"
                >
                  {linkedin ? (linkedin.needsRelogin ? "Precisa religar" : "Conectado") : "Desconectado"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {linkedin?.profileUsername ?? "Clique em Gerenciar para ver instruções"}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Vertex AI (Google Cloud / Gemini) ────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Vertex AI (Google Cloud)</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Quando configurado, o agente SDR e a qualificação usam Gemini via Vertex AI em vez do OpenRouter.
          </p>
        </div>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Service Account GCP</CardTitle>
              <Badge variant={vertex.configured ? "default" : "secondary"} className="text-xs">
                {vertex.configured ? "Configurado" : "Não configurado"}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Forneça o JSON do service account com permissão Vertex AI User no projeto GCP.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VertexForm
              configured={vertex.configured}
              projectId={vertex.projectId}
              location={vertex.location}
              model={vertex.model}
            />
          </CardContent>
        </Card>
      </section>

      {/* ── Hermes (cerebro do atendimento) ──────────── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Hermes (cérebro do atendimento)</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Quando configurado, o agente SDR usa o Hermes (Nous Research) para conversar, no
            lugar do Gemini/Vertex. Os canais (WhatsApp, email), tools e treino continuam no
            minerador. Sem esta credencial, segue no Gemini.
          </p>
        </div>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Servidor Hermes</CardTitle>
              <Badge variant={hermes.configured ? "default" : "secondary"} className="text-xs">
                {hermes.configured ? "Configurado" : "Não configurado"}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Informe a URL do container, a API_SERVER_KEY e (opcional) o modelo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HermesForm
              configured={hermes.configured}
              baseUrl={hermes.baseUrl}
              model={hermes.model}
            />
          </CardContent>
        </Card>
      </section>

      {/* ── Chaves de API ────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Chaves de API</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              OpenRouter, Apify, Google Places. Pode cadastrar várias chaves do mesmo serviço
              (ex: múltiplas contas Apify) e trocar qual está em uso no botão &quot;Usar esta&quot;.
            </p>
          </div>
          <CredentialDialog />
        </div>
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serviço</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Em uso</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeyList.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8 text-sm">
                    Nenhuma chave cadastrada
                  </TableCell>
                </TableRow>
              ) : (
                apiKeyList.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Badge variant="secondary">{row.provider}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell>
                      <SetActiveCredentialButton
                        id={row.id}
                        isActive={effectiveActiveByProvider.get(row.provider) === row.id}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {row.createdAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteCredentialButton id={row.id} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
