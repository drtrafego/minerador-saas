"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/auth/guards";
import { MissingCredentialError } from "@/lib/credentials/get";
import {
  analisarDocumento,
  salvarCerebro,
  salvarComportamento,
  criarFato,
  atualizarFato,
  removerFato,
} from "@/lib/agent/knowledge";

const MAX_BYTES = 100 * 1024; // 100 KB
const MAX_FATOS = 64;

// ---- Tipos compartilhados com o cliente ----

export type AnaliseState = {
  ok: boolean;
  message: string;
  preview?: {
    behavior: string;
    knowledge: { title: string; content: string }[];
  };
};

export type ActionState = {
  ok: boolean;
  message: string;
};

// ---- Analisar documento (retorna preview, NAO salva) ----

export async function analisarDocumentoAction(
  _prev: AnaliseState,
  formData: FormData,
): Promise<AnaliseState> {
  const { organizationId } = await requireOrg();

  let texto = "";
  const file = formData.get("arquivo");
  if (file instanceof File && file.size > 0) {
    if (!/\.(md|txt)$/i.test(file.name)) {
      return { ok: false, message: "Formato inválido. Use .md ou .txt." };
    }
    if (file.size > MAX_BYTES) {
      return {
        ok: false,
        message: "Arquivo muito grande. Limite de 100 KB. Divida em partes menores.",
      };
    }
    try {
      texto = await file.text();
    } catch {
      return { ok: false, message: "Não foi possível ler o arquivo." };
    }
  } else {
    const campo = formData.get("texto");
    texto = typeof campo === "string" ? campo : "";
  }

  texto = texto.trim();
  if (texto.length < 20) {
    return { ok: false, message: "Cole um texto ou suba um arquivo (mínimo 20 caracteres)." };
  }

  if (Buffer.byteLength(texto, "utf8") > MAX_BYTES) {
    return {
      ok: false,
      message: "Texto muito grande. Limite de 100 KB. Divida em partes menores.",
    };
  }

  try {
    const preview = await analisarDocumento({ organizationId, text: texto });
    return {
      ok: true,
      message: `Agente separou ${preview.knowledge.length} fato(s). Revise e confirme.`,
      preview,
    };
  } catch (err) {
    let msg = "Erro ao analisar o documento.";
    if (err instanceof MissingCredentialError) {
      msg =
        "Credencial OpenRouter ou Vertex não configurada. Vá em Configurações > Credenciais e adicione a chave antes de treinar o agente.";
    } else if (err instanceof Error) {
      msg = err.message;
    }
    return { ok: false, message: msg };
  }
}

// ---- Confirmar e salvar cerebro (a partir do preview) ----

const confirmSchema = z.object({
  behavior: z.string(),
  knowledge: z
    .array(
      z.object({
        title: z.string().min(1),
        content: z.string().min(1),
      }),
    )
    .max(MAX_FATOS, `máximo de ${MAX_FATOS} fatos`),
});

export async function confirmarCerebroAction(payload: {
  behavior: string;
  knowledge: { title: string; content: string }[];
}): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const parsed = confirmSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "dados inválidos",
    };
  }

  if (!parsed.data.behavior.trim() && parsed.data.knowledge.length === 0) {
    return { ok: false, message: "Nenhum conteúdo para salvar." };
  }

  try {
    const { itemsSaved } = await salvarCerebro({
      organizationId,
      behavior: parsed.data.behavior,
      knowledge: parsed.data.knowledge,
    });
    revalidatePath("/settings/agent/knowledge");
    return {
      ok: true,
      message: `Cérebro salvo: comportamento + ${itemsSaved} fato(s).`,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Erro ao salvar o cérebro.",
    };
  }
}

// ---- Salvar comportamento (standalone, substitui) ----

export async function salvarComportamentoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const texto = (formData.get("comportamento") as string | null) ?? "";
  if (!texto.trim()) {
    return { ok: false, message: "O comportamento não pode ficar vazio." };
  }

  try {
    await salvarComportamento({ organizationId, behavior: texto });
    revalidatePath("/settings/agent/knowledge");
    return { ok: true, message: "Comportamento salvo." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Erro ao salvar.",
    };
  }
}

// ---- CRUD de fatos manuais ----

const fatoSchema = z.object({
  title: z.string().min(1, "Informe um título."),
  content: z.string().min(1, "Informe o conteúdo."),
  tags: z.string().optional(),
});

export async function criarFatoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const parsed = fatoSchema.safeParse({
    title: formData.get("title"),
    content: formData.get("content"),
    tags: formData.get("tags"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "dados inválidos" };
  }

  try {
    await criarFato({ organizationId, ...parsed.data });
    revalidatePath("/settings/agent/knowledge");
    return { ok: true, message: "Fato adicionado." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Erro ao adicionar.",
    };
  }
}

export async function atualizarFatoAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const id = formData.get("id");
  if (typeof id !== "string" || !id) {
    return { ok: false, message: "Fato inválido." };
  }

  const parsed = fatoSchema.safeParse({
    title: formData.get("title"),
    content: formData.get("content"),
    tags: formData.get("tags"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "dados inválidos" };
  }

  try {
    await atualizarFato({ organizationId, id, ...parsed.data });
    revalidatePath("/settings/agent/knowledge");
    return { ok: true, message: "Fato atualizado." };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Erro ao salvar.",
    };
  }
}

export async function removerFatoAction(formData: FormData): Promise<void> {
  const { organizationId } = await requireOrg();
  const id = formData.get("id");
  if (typeof id !== "string" || !id) return;
  await removerFato({ organizationId, id });
  revalidatePath("/settings/agent/knowledge");
}
