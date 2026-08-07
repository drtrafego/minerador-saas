"""Cliente para o servidor proprio de transcricao (faster-whisper no VPS Minerador SaaS)."""
import logging
import uuid

import httpx

from config import settings

logger = logging.getLogger(__name__)


_MIME_EXTENSIONS = {
    "audio/ogg": "ogg",
    "audio/ogg; codecs=opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm",
}


def _extension_for(mime_type: str) -> str:
    if not mime_type:
        return "ogg"
    base = mime_type.split(";", 1)[0].strip().lower()
    return _MIME_EXTENSIONS.get(base) or _MIME_EXTENSIONS.get(mime_type.lower(), "ogg")


async def transcribe(audio_bytes: bytes, mime_type: str = "audio/ogg") -> str:
    """Envia audio para o servidor proprio e retorna o texto transcrito.

    Pipeline:
    1. POST /videos/upload com multipart/form-data, retorna {video_path}.
    2. POST /transcribe com {video_path, language: 'pt'}, retorna o texto.
    """
    base_url = settings.TRANSCREVER_API_URL.rstrip("/")
    if not base_url:
        logger.error("TRANSCREVER_API_URL nao configurado")
        return ""

    filename = f"wa_audio_{uuid.uuid4().hex}.{_extension_for(mime_type)}"

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            upload_resp = await client.post(
                f"{base_url}/videos/upload",
                files={"file": (filename, audio_bytes, mime_type or "application/octet-stream")},
            )
            if upload_resp.status_code != 200:
                logger.error(
                    "transcrever upload falhou status=%s body=%s",
                    upload_resp.status_code,
                    upload_resp.text[:300],
                )
                return ""
            upload_data = upload_resp.json()
            video_path = (
                upload_data.get("video_path")
                or upload_data.get("path")
                or upload_data.get("file_path")
                or upload_data.get("filename")
            )
            if not video_path:
                logger.error("upload sem caminho retornado: %s", upload_data)
                return ""

            tx_resp = await client.post(
                f"{base_url}/transcribe",
                json={"video_path": video_path, "language": "pt"},
            )
            if tx_resp.status_code != 200:
                logger.error(
                    "transcrever /transcribe falhou status=%s body=%s",
                    tx_resp.status_code,
                    tx_resp.text[:300],
                )
                return ""
            data = tx_resp.json()
            text = (
                data.get("text")
                or data.get("transcription")
                or data.get("transcricao")
                or data.get("result")
                or ""
            )
            if not text and isinstance(data, dict):
                segments = data.get("segments") or []
                if isinstance(segments, list):
                    text = " ".join(seg.get("text", "") for seg in segments if isinstance(seg, dict)).strip()
            return text.strip() if isinstance(text, str) else ""
    except Exception as exc:
        logger.error("transcrever erro: %s", exc, exc_info=True)
        return ""
