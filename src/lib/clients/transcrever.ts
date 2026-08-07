/**
 * Cliente do servidor proprio de transcricao (Whisper local no VPS).
 *
 * Contrato confirmado pelo servidor real (api.transcrever, "Video Transcription
 * API" na porta 8765 atras de nginx na porta 80) e pelo pipeline de referencia
 * em mvp_agent_vibe/audio/pipeline.py:
 *   1. POST {BASE}/videos/upload (multipart) -> { filename }
 *   2. POST {BASE}/transcribe { video_path: "/opt/transcrever/videos/<filename>",
 *      language: "pt" } -> { status: "success", text }
 *
 * Observacao: o servidor responde por HTTP (porta 80), nao HTTPS (sem SSL na 443).
 * Por isso o default e http://. Configuravel por TRANSCREVER_API_URL. Zero token de LLM.
 */
const BASE_URL = (
  process.env.TRANSCREVER_API_URL ?? "http://api.transcrever.seu-dominio.com"
).replace(/\/$/, "");

// Path interno do servidor onde o upload salva os arquivos.
const VIDEOS_PATH = (
  process.env.TRANSCREVER_VIDEOS_PATH ?? "/opt/transcrever/videos"
).replace(/\/$/, "");

const TIMEOUT_MS = 180_000;

export async function transcribeAudio(
  audio: Uint8Array,
  mimeType = "audio/ogg",
): Promise<string> {
  if (!BASE_URL) return "";

  const suffix = mimeType.includes("ogg") ? "ogg" : "mp4";
  const filename = `wa_${crypto.randomUUID().replace(/-/g, "").slice(0, 30)}.${suffix}`;

  try {
    // 1. Upload
    const form = new FormData();
    form.append(
      "file",
      new Blob([audio as BlobPart], { type: mimeType || "application/octet-stream" }),
      filename,
    );
    const upload = await fetch(`${BASE_URL}/videos/upload`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!upload.ok) {
      console.error(`[transcrever] upload falhou: ${upload.status}`);
      return "";
    }
    const upData = (await upload.json()) as { filename?: string };
    const uploadedFilename = upData.filename ?? filename;

    // 2. Transcrever com o caminho absoluto do servidor
    const videoPath = `${VIDEOS_PATH}/${uploadedFilename}`;
    const tx = await fetch(`${BASE_URL}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_path: videoPath, language: "pt" }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!tx.ok) {
      console.error(`[transcrever] transcribe falhou: ${tx.status}`);
      return "";
    }
    const data = (await tx.json()) as { status?: string; text?: string };
    if (data.status !== "success") {
      console.error("[transcrever] status nao-success:", data.status);
      return "";
    }
    return (data.text ?? "").trim();
  } catch (err) {
    console.error("[transcrever] erro:", err);
    return "";
  }
}
