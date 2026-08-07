import { requireOrg } from "@/lib/auth/guards";
import { loadWhatsAppAPICredential } from "@/lib/clients/whatsapp-api";
import { loadUazAPICredential, getUazAPIStatus } from "@/lib/clients/whatsapp-uazapi";
import { db } from "@/lib/db/client";
import { credentials } from "@/db/schema/credentials";
import { agentConfigs } from "@/db/schema/agent";
import { decryptCredential } from "@/lib/crypto/credentials";
import { and, eq, desc } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WhatsAppMetaForm, WhatsAppUazAPIForm, PreferredProviderForm } from "./whatsapp-forms";

async function getQRStatus(organizationId: string) {
  const row = await db.query.credentials.findFirst({
    where: and(
      eq(credentials.organizationId, organizationId),
      eq(credentials.provider, "whatsapp_session"),
    ),
    orderBy: desc(credentials.createdAt),
  });
  if (!row) return null;
  try {
    const data = await decryptCredential<{ phoneNumber: string; savedAt: number }>(row.ciphertext);
    return { phoneNumber: data.phoneNumber, savedAt: new Date(data.savedAt) };
  } catch {
    return null;
  }
}

async function getPreferredProvider(organizationId: string): Promise<"auto" | "meta" | "uazapi"> {
  const row = await db
    .select({ preferredProvider: agentConfigs.preferredProvider })
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, organizationId))
    .limit(1)
    .then((r) => r[0] ?? null);
  return (row?.preferredProvider as "auto" | "meta" | "uazapi") ?? "auto";
}

export default async function WhatsAppSettingsPage() {
  const { organizationId } = await requireOrg();

  const [qrStatus, apiCred, uazapiCred, preferredProvider] = await Promise.all([
    getQRStatus(organizationId),
    loadWhatsAppAPICredential(organizationId),
    loadUazAPICredential(organizationId),
    getPreferredProvider(organizationId),
  ]);

  const uazapiStatus = uazapiCred ? await getUazAPIStatus(uazapiCred.cred) : null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://seu-dominio.com";
  const webhookUrl = `${appUrl}/api/webhooks/whatsapp`;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Configure os canais de envio e recepcao de mensagens via WhatsApp.
        </p>
      </div>

      {/* Provider preferido */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Canal preferido</CardTitle>
          <CardDescription>
            Qual API usar para enviar mensagens quando mais de uma estiver configurada.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PreferredProviderForm current={preferredProvider} />
        </CardContent>
      </Card>

      {/* Meta WABA */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">WhatsApp Business API (Meta)</CardTitle>
            <Badge variant={apiCred ? "default" : "secondary"}>
              {apiCred ? "Configurado" : "Nao configurado"}
            </Badge>
          </div>
          <CardDescription>
            API oficial da Meta. Requer conta WhatsApp Business verificada no Meta Business Manager.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WhatsAppMetaForm
            configured={!!apiCred}
            phoneNumberIdPreview={
              apiCred
                ? apiCred.cred.phone_number_id.slice(0, 6) + "..." + apiCred.cred.phone_number_id.slice(-4)
                : null
            }
            wabaIdPreview={
              apiCred?.cred.waba_id
                ? apiCred.cred.waba_id.slice(0, 6) + "..." + apiCred.cred.waba_id.slice(-4)
                : null
            }
            hasAppSecret={!!apiCred?.cred.app_secret}
            webhookUrl={webhookUrl}
          />
        </CardContent>
      </Card>

      {/* UazAPI */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">UazAPI (self-hosted)</CardTitle>
            <Badge
              variant={
                uazapiStatus === "connected" ? "default" : uazapiCred ? "secondary" : "secondary"
              }
            >
              {uazapiStatus === "connected"
                ? "Conectado"
                : uazapiStatus === "connecting"
                  ? "Conectando..."
                  : uazapiCred
                    ? "Configurado"
                    : "Nao configurado"}
            </Badge>
          </div>
          <CardDescription>
            API REST auto-hospedada (ou cloud UazAPI). Conecte o numero via QR no painel do UazAPI apos salvar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WhatsAppUazAPIForm
            configured={!!uazapiCred}
            baseUrl={uazapiCred?.cred.base_url ?? null}
            status={uazapiStatus}
            webhookUrl={webhookUrl}
          />
        </CardContent>
      </Card>

      {/* WhatsApp QR Baileys */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">WhatsApp QR (Baileys)</CardTitle>
            <Badge variant={qrStatus ? "default" : "secondary"}>
              {qrStatus ? "Conectado" : "Desconectado"}
            </Badge>
          </div>
          <CardDescription>
            Conecta via QR Code direto, sem conta Business. Requer acesso ao servidor para escanear.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {qrStatus ? (
            <>
              <p><span className="text-muted-foreground">Numero: </span>+{qrStatus.phoneNumber}</p>
              <p><span className="text-muted-foreground">Conectado em: </span>{qrStatus.savedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>
            </>
          ) : (
            <p className="text-muted-foreground">Nenhuma sessao ativa.</p>
          )}
          <div className="rounded-md bg-muted px-3 py-2 text-xs">
            <span className="text-muted-foreground">Comando para conectar via terminal: </span>
            <span className="font-mono select-all">pnpm whatsapp:login --org {organizationId}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
