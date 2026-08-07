import "server-only";
import { getOrgCredential, MissingCredentialError } from "@/lib/credentials/get";

export class BrevoNotConfiguredError extends Error {
  constructor() {
    super("Credencial Brevo nao configurada para esta organizacao");
    this.name = "BrevoNotConfiguredError";
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Converte o corpo (texto puro com quebras de linha) em HTML legivel:
// linhas em branco viram paragrafos e quebras simples viram <br>. Sem isso o
// HTML colapsa os \n e o email chega com tudo junto, sem paragrafos.
function textoParaHtml(body: string): string {
  const paragrafos = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => escapeHtml(p.trim()).replace(/\n/g, "<br>"))
    .filter((p) => p.length > 0)
    .map((p) => `<p style="margin:0 0 16px 0">${p}</p>`)
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#222222">${paragrafos}</div>`;
}

export async function sendBrevoEmail(opts: {
  organizationId: string;
  to: string;
  toName?: string;
  subject: string;
  body: string;
  /** Message-ID da mensagem que esta sendo respondida (para threading). */
  inReplyTo?: string;
  /** Cadeia completa de Message-IDs para o header References. */
  references?: string;
}): Promise<{ messageId: string }> {
  let cred: { apiKey: string; senderEmail: string; senderName?: string; replyToEmail?: string };
  try {
    cred = await getOrgCredential(opts.organizationId, "brevo");
  } catch (err) {
    if (err instanceof MissingCredentialError) {
      throw new BrevoNotConfiguredError();
    }
    throw err;
  }

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": cred.apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        email: cred.senderEmail,
        name: cred.senderName || cred.senderEmail,
      },
      to: [
        {
          email: opts.to,
          ...(opts.toName ? { name: opts.toName } : {}),
        },
      ],
      subject: opts.subject,
      htmlContent: textoParaHtml(opts.body),
      textContent: opts.body,
      ...(opts.inReplyTo
        ? {
            headers: {
              "In-Reply-To": opts.inReplyTo,
              References: opts.references ?? opts.inReplyTo,
            },
          }
        : {}),
      ...(cred.replyToEmail
        ? { replyTo: { email: cred.replyToEmail } }
        : {}),
    }),
  });

  const data = (await resp.json().catch(() => ({}))) as {
    messageId?: string;
    message?: string;
    code?: string;
  };

  if (resp.status === 201) {
    return { messageId: data.messageId ?? "" };
  }

  throw new Error(
    data.message
      ? `Brevo erro: ${data.message}`
      : `Brevo respondeu status ${resp.status}`,
  );
}
