import { sql } from "drizzle-orm";
import { text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";
import { organization } from "./auth";

/**
 * Base de conhecimento do agente (RAG). Documentos enviados pelo usuario pelo
 * frontend sao "splitados" pelo LLM em itens consultaveis (fatos), salvos aqui
 * e recuperados pela tool search_knowledge durante a conversa. Multi-tenant por
 * organizationId. Busca por full-text em portugues (sem dependencia de provider
 * de embeddings); pode evoluir para pgvector depois.
 *
 * sourceDocument = 'cerebro' => item gerado via fluxo "Alimentar cerebro" (preview -> confirmar).
 *   Esses itens sao substituidos a cada nova confirmacao do cerebro.
 * sourceDocument = <nome_arquivo> => upload direto (legado).
 * sourceDocument = null => adicionado manualmente via form.
 */
export const knowledgeBase = ms.table(
  "knowledge_base",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    sourceDocument: text("source_document"),
    tags: text("tags"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("knowledge_base_org_idx").on(t.organizationId)],
);
