import { desc, eq } from "drizzle-orm";
import { requireOrg } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { knowledgeBase } from "@/db/schema/knowledge";
import { agentConfigs } from "@/db/schema/agent";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UploadCerebro } from "./upload-cerebro";
import { ComportamentoForm } from "./comportamento-form";
import { KnowledgeForm } from "./knowledge-form";
import { KnowledgeItem, type KnowledgeItemData } from "./knowledge-item";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const { organizationId } = await requireOrg();

  const [config, fatos] = await Promise.all([
    db
      .select({ businessInfo: agentConfigs.businessInfo })
      .from(agentConfigs)
      .where(eq(agentConfigs.organizationId, organizationId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    db
      .select()
      .from(knowledgeBase)
      .where(eq(knowledgeBase.organizationId, organizationId))
      .orderBy(desc(knowledgeBase.createdAt))
      .limit(200),
  ]);

  const comportamento = config?.businessInfo ?? "";

  const itens: KnowledgeItemData[] = fatos.map((f) => ({
    id: f.id,
    title: f.title,
    content: f.content,
    tags: f.tags ?? null,
    sourceDocument: f.sourceDocument ?? null,
    createdAt: f.createdAt.toISOString(),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Cérebro do agente</h1>
        <p className="text-sm text-muted-foreground">
          Cole ou suba um material abaixo. O agente separa sozinho o que é comportamento
          (como o agente fala) e o que é fato (o que ele sabe), e mostra um preview para
          você revisar antes de salvar.
        </p>
      </div>

      {comportamento || fatos.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          <span className="font-medium">Cérebro salvo:</span>
          <span>
            comportamento{" "}
            {comportamento
              ? `definido (${comportamento.length} caracteres)`
              : "vazio"}
          </span>
          <span className="text-success/60">·</span>
          <span>{fatos.length} fato(s) no conhecimento</span>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Alimentar cérebro</CardTitle>
          <CardDescription>
            Único lugar para colar ou subir o material. O agente divide o texto e mostra
            um preview. Nada é salvo até você confirmar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadCerebro />
        </CardContent>
      </Card>

      <details
        open={fatos.length > 0 || Boolean(comportamento)}
        className="group rounded-lg border border-border bg-muted/40"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-muted-foreground select-none hover:text-foreground">
          <span>Ver e ajustar manualmente (avançado)</span>
          <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">
            &#9662;
          </span>
        </summary>

        <div className="space-y-6 border-t border-border p-4">
          <p className="text-xs text-muted-foreground">
            Resultado do que foi salvo. Edite aqui só se precisar de um ajuste fino. O
            caminho normal é alimentar o cérebro acima.
          </p>

          <Card>
            <CardHeader>
              <CardTitle>Comportamento (system prompt)</CardTitle>
              <CardDescription>
                Instrução de tom, regras e personalidade que o agente segue em toda
                conversa. Salvar aqui <strong>substitui</strong> o conteúdo atual.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ComportamentoForm comportamento={comportamento} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Conhecimento ({fatos.length} fato(s))</CardTitle>
              <CardDescription>
                Fatos que o agente consulta para responder. Edite ou remova abaixo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {itens.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum fato cadastrado ainda.
                </p>
              ) : (
                <div className="space-y-3">
                  {itens.map((item) => (
                    <KnowledgeItem key={item.id} item={item} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Adicionar fato manualmente</CardTitle>
              <CardDescription>
                Indexado na base de conhecimento assim que você salva.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <KnowledgeForm />
            </CardContent>
          </Card>
        </div>
      </details>
    </div>
  );
}
