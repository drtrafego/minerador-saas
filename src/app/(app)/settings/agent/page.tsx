import { eq } from "drizzle-orm";
import { requireOrg } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { agentConfigs } from "@/db/schema/agent";
import { AgentForm } from "./form";

export const dynamic = "force-dynamic";

export default async function AgentSettingsPage() {
  const { organizationId } = await requireOrg();

  const [row] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, organizationId))
    .limit(1);

  const initial = row ?? {
    enabled: false,
    agentName: "Isabela",
    businessName: "",
    businessInfo: "",
    tone: "profissional e direto",
    systemPromptOverride: "",
    rules: [] as string[],
    handoffKeywords: ["humano", "atendente", "parar", "stop"],
    maxAutoReplies: 6,
    model: "gemini-2.5-flash",
    followUpModel: null as string | null,
    knowledgeModel: null as string | null,
    temperature: 70,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agente IA</h1>
        <p className="text-sm text-muted-foreground">
          Quando ativado, a Isabela responde automaticamente as mensagens inbound (email e WhatsApp)
          usando o modelo de IA configurado.
        </p>
        <a
          href="/settings/agent/knowledge"
          className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Treinar a Isabela (cerebro: enviar documentos .md e ajustar comportamento) &rarr;
        </a>
      </div>

      <AgentForm
        initial={{
          enabled: Boolean(initial.enabled),
          agentName: initial.agentName ?? "Isabela",
          businessName: initial.businessName ?? "",
          businessInfo: initial.businessInfo ?? "",
          tone: initial.tone ?? "profissional e direto",
          systemPromptOverride: initial.systemPromptOverride ?? "",
          rules: (initial.rules as string[]) ?? [],
          handoffKeywords: (initial.handoffKeywords as string[]) ?? [],
          maxAutoReplies: initial.maxAutoReplies ?? 6,
          model: initial.model ?? "gemini-2.5-flash",
          followUpModel: initial.followUpModel ?? "",
          knowledgeModel: initial.knowledgeModel ?? "",
          temperature: initial.temperature ?? 70,
        }}
      />
    </div>
  );
}
