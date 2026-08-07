/**
 * RAG do agente: analise, ingestao e recuperacao de conhecimento.
 *
 * Fluxo principal (cerebro):
 *   analisarDocumento  -> chama o LLM, retorna preview { behavior, knowledge[] } SEM salvar
 *   salvarCerebro      -> persiste behavior (substitui businessInfo) + knowledge (substitui itens 'cerebro')
 *
 * Fluxo manual:
 *   criarFato / atualizarFato / removerFato  -> CRUD avulso de fatos
 *   salvarComportamento                       -> substitui businessInfo diretamente
 *
 * Legado (backward compat):
 *   ingestDocument -> analisa + salva (mescla behavior) em uma unica chamada
 *
 * Busca:
 *   searchKnowledge -> full-text portugues (sem pgvector)
 */
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { knowledgeBase } from "@/db/schema/knowledge";
import { agentConfigs } from "@/db/schema/agent";
import { getOrgCredential, MissingCredentialError } from "@/lib/credentials/get";
import { ingestDocumentVertex } from "@/lib/clients/vertex";

// ---- Helpers internos ----

function makeClient(apiKey: string): Anthropic {
  if (apiKey.startsWith("sk-or-")) {
    return new Anthropic({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: { "HTTP-Referer": "https://seu-dominio.com" },
    });
  }
  return new Anthropic({ apiKey });
}

function resolveModel(apiKey: string, model: string): string {
  if (apiKey.startsWith("sk-or-")) {
    return model.includes("/") ? model : `anthropic/${model}`;
  }
  return model;
}

const SPLIT_TOOL = {
  name: "split_document",
  description:
    "Separa um documento em comportamento/diretrizes (vao para o prompt do agente) " +
    "e fatos consultaveis (viram itens de conhecimento pesquisaveis).",
  input_schema: {
    type: "object" as const,
    properties: {
      behavior: {
        type: "string",
        description:
          "Diretrizes de comportamento, tom, personalidade e regras extraidas do documento. Vazio se nao houver.",
      },
      knowledge: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            content: { type: "string" },
          },
          required: ["title", "content"],
        },
        description:
          "Fatos, dados, precos, servicos, politicas e FAQ consultaveis, cada um como item titulo+conteudo.",
      },
    },
    required: ["behavior", "knowledge"],
  },
};

// ---- Analise (LLM, sem persistencia) ----

export type SplitResult = {
  behavior: string;
  knowledge: Array<{ title: string; content: string }>;
};

/**
 * Chama o LLM (Vertex AI ou OpenRouter) para separar o documento em
 * comportamento + fatos. NAO salva nada. Retorna o preview para o usuario
 * revisar antes de confirmar.
 */
export async function analisarDocumento(opts: {
  organizationId: string;
  text: string;
  model?: string;
}): Promise<SplitResult> {
  const [existingConfig] = await db
    .select({ knowledgeModel: agentConfigs.knowledgeModel })
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, opts.organizationId))
    .limit(1);

  const knowledgeModel = existingConfig?.knowledgeModel ?? opts.model ?? undefined;

  // Tenta Vertex AI primeiro se a org tiver credencial
  try {
    const vertexCred = await getOrgCredential(opts.organizationId, "google_vertex");
    return await ingestDocumentVertex({
      cred: vertexCred,
      text: opts.text,
      model: knowledgeModel ?? undefined,
    });
  } catch (err) {
    if (!(err instanceof MissingCredentialError)) throw err;
    // Sem credencial Vertex: cai para OpenRouter/Anthropic
  }

  const cred = await getOrgCredential(opts.organizationId, "openrouter");
  const client = makeClient(cred.apiKey);
  const rawModel = knowledgeModel ?? cred.model ?? "claude-sonnet-4-5";
  const isClaude =
    rawModel.startsWith("claude") || rawModel.startsWith("anthropic/");
  const model = resolveModel(cred.apiKey, isClaude ? rawModel : "claude-sonnet-4-5");

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system:
      "Voce organiza documentos para um agente SDR. Separe COMPORTAMENTO (tom, personalidade, " +
      "regras, diretrizes de como agir) de FATOS CONSULTAVEIS (precos, servicos, dados, politicas, FAQ). " +
      "Use a ferramenta split_document. Responda em portugues.",
    tools: [SPLIT_TOOL],
    tool_choice: { type: "tool", name: "split_document" },
    messages: [
      { role: "user", content: `Separe este documento:\n\n${opts.text}` },
    ],
  });

  let behavior = "";
  let knowledge: Array<{ title: string; content: string }> = [];
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "split_document") {
      const input = block.input as {
        behavior?: string;
        knowledge?: Array<{ title: string; content: string }>;
      };
      behavior = input.behavior ?? "";
      knowledge = input.knowledge ?? [];
      break;
    }
  }

  return { behavior, knowledge };
}

// ---- Persistencia do cerebro (substitui) ----

/**
 * Salva o resultado confirmado do cerebro:
 * - behavior substitui agentConfigs.businessInfo (NAO mescla)
 * - knowledge substitui TODOS os itens com sourceDocument='cerebro' da org
 *
 * Itens adicionados manualmente (sourceDocument = null) nao sao tocados.
 */
export async function salvarCerebro(opts: {
  organizationId: string;
  behavior: string;
  knowledge: Array<{ title: string; content: string }>;
}): Promise<{ itemsSaved: number }> {
  const { organizationId, behavior, knowledge } = opts;

  await db.transaction(async (tx) => {
    // Substitui comportamento
    await tx
      .insert(agentConfigs)
      .values({
        organizationId,
        businessInfo: behavior.trim() || null,
      })
      .onConflictDoUpdate({
        target: agentConfigs.organizationId,
        set: {
          businessInfo: behavior.trim() || null,
          updatedAt: new Date(),
        },
      });

    // Apaga itens anteriores do fluxo cerebro (idempotencia)
    await tx
      .delete(knowledgeBase)
      .where(
        and(
          eq(knowledgeBase.organizationId, organizationId),
          eq(knowledgeBase.sourceDocument, "cerebro"),
        ),
      );

    if (knowledge.length > 0) {
      await tx.insert(knowledgeBase).values(
        knowledge.map((item) => ({
          organizationId,
          title: item.title.slice(0, 500),
          content: item.content,
          sourceDocument: "cerebro",
          tags: null as string | null,
        })),
      );
    }
  });

  return { itemsSaved: knowledge.length };
}

/**
 * Salva somente o comportamento (system prompt / businessInfo).
 * Substitui o valor atual.
 */
export async function salvarComportamento(opts: {
  organizationId: string;
  behavior: string;
}): Promise<void> {
  await db
    .insert(agentConfigs)
    .values({
      organizationId: opts.organizationId,
      businessInfo: opts.behavior.trim() || null,
    })
    .onConflictDoUpdate({
      target: agentConfigs.organizationId,
      set: {
        businessInfo: opts.behavior.trim() || null,
        updatedAt: new Date(),
      },
    });
}

// ---- CRUD de fatos manuais ----

export async function criarFato(opts: {
  organizationId: string;
  title: string;
  content: string;
  tags?: string;
}): Promise<void> {
  await db.insert(knowledgeBase).values({
    organizationId: opts.organizationId,
    title: opts.title.trim().slice(0, 500),
    content: opts.content.trim(),
    sourceDocument: null,
    tags: opts.tags?.trim() || null,
  });
}

export async function atualizarFato(opts: {
  organizationId: string;
  id: string;
  title: string;
  content: string;
  tags?: string;
}): Promise<void> {
  await db
    .update(knowledgeBase)
    .set({
      title: opts.title.trim().slice(0, 500),
      content: opts.content.trim(),
      tags: opts.tags?.trim() || null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(knowledgeBase.id, opts.id),
        eq(knowledgeBase.organizationId, opts.organizationId),
      ),
    );
}

export async function removerFato(opts: {
  organizationId: string;
  id: string;
}): Promise<void> {
  await db
    .delete(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.id, opts.id),
        eq(knowledgeBase.organizationId, opts.organizationId),
      ),
    );
}

// ---- Legado: ingestDocument (mescla, sem preview) ----

export type IngestResult = { behavior: string; itemsSaved: number };

/**
 * Analisa + salva em uma unica chamada (fluxo legado, sem preview).
 * behavior e MESCLADO ao businessInfo existente (ao contrario do salvarCerebro que substitui).
 * Mantido para backward compat; a nova UI usa analisarDocumento + salvarCerebro.
 */
export async function ingestDocument(opts: {
  organizationId: string;
  text: string;
  sourceDocument?: string;
  model?: string;
}): Promise<IngestResult> {
  const { behavior, knowledge } = await analisarDocumento(opts);

  if (knowledge.length > 0) {
    await db.insert(knowledgeBase).values(
      knowledge.map((kItem) => ({
        organizationId: opts.organizationId,
        title: kItem.title.slice(0, 500),
        content: kItem.content,
        sourceDocument: opts.sourceDocument ?? null,
        tags: null as string | null,
      })),
    );
  }

  if (behavior.trim()) {
    const [existingConfig] = await db
      .select({ businessInfo: agentConfigs.businessInfo })
      .from(agentConfigs)
      .where(eq(agentConfigs.organizationId, opts.organizationId))
      .limit(1);

    if (existingConfig) {
      const merged = [existingConfig.businessInfo ?? "", behavior.trim()]
        .filter(Boolean)
        .join("\n\n");
      await db
        .update(agentConfigs)
        .set({ businessInfo: merged, updatedAt: new Date() })
        .where(eq(agentConfigs.organizationId, opts.organizationId));
    }
  }

  return { behavior, itemsSaved: knowledge.length };
}

// ---- Busca (full-text portugues) ----

export async function searchKnowledge(opts: {
  organizationId: string;
  query: string;
  k?: number;
}): Promise<Array<{ title: string; content: string }>> {
  // k reduzido de 4 para 3: menos itens no contexto, menos tokens de entrada.
  const k = opts.k ?? 3;
  const rows = await db
    .select({ title: knowledgeBase.title, content: knowledgeBase.content })
    .from(knowledgeBase)
    .where(
      and(
        eq(knowledgeBase.organizationId, opts.organizationId),
        sql`to_tsvector('portuguese', ${knowledgeBase.title} || ' ' || ${knowledgeBase.content}) @@ plainto_tsquery('portuguese', ${opts.query})`,
      ),
    )
    .limit(k);

  // Trunca o conteudo de cada item a 800 caracteres para limitar tokens no contexto do agente.
  return rows.map((row) => ({
    title: row.title,
    content: row.content.slice(0, 800),
  }));
}
