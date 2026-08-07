import "server-only";
import type { BrowserContext, Page } from "playwright";
import {
  loadBrowserSession,
  saveBrowserSession,
} from "@/lib/clients/browser/storage";
import {
  withBrowser,
  type BrowserSessionPayload,
} from "@/lib/clients/browser/runtime";
import {
  humanDelay,
  humanMoveTo,
  humanScroll,
  randomInt,
  typeHumanLike,
} from "@/lib/clients/browser/human";

export class LinkedInBlockedError extends Error {
  constructor(message = "LinkedIn bloqueou a sessao") {
    super(message);
    this.name = "LinkedInBlockedError";
  }
}

export class LinkedInNeedsReloginError extends Error {
  constructor(message = "LinkedIn precisa de novo login") {
    super(message);
    this.name = "LinkedInNeedsReloginError";
  }
}

export class LinkedInProfileNotFoundError extends Error {
  constructor(profileUrl: string, detail?: string) {
    super(
      `LinkedIn profile ${profileUrl} nao encontrado${
        detail ? `, detalhe, ${detail}` : ""
      }`,
    );
    this.name = "LinkedInProfileNotFoundError";
  }
}

const LOCATOR_TIMEOUT = 15000;

async function detectNeedsLogin(page: Page): Promise<boolean> {
  const url = page.url();
  if (/\/uas\/login/i.test(url) || /\/login/i.test(url)) return true;
  const needles = [
    "Sign in to LinkedIn",
    "Entrar no LinkedIn",
    "Iniciar sesion en LinkedIn",
  ];
  for (const needle of needles) {
    try {
      const loc = page.getByText(needle, { exact: false });
      if ((await loc.count()) > 0) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

async function detectProfileNotFound(page: Page): Promise<boolean> {
  const needles = [
    "This profile is not available",
    "Este perfil nao esta disponivel",
    "Esta pagina nao existe",
    "Page not found",
    "Pagina nao encontrada",
  ];
  for (const needle of needles) {
    try {
      const loc = page.getByText(needle, { exact: false });
      if ((await loc.count()) > 0) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

async function detectRateLimit(page: Page): Promise<boolean> {
  const needles = [
    "You've reached the weekly invitation limit",
    "Voce atingiu o limite semanal",
    "Nao foi possivel enviar a mensagem",
    "Unable to send message",
    "Too many requests",
  ];
  for (const needle of needles) {
    try {
      const loc = page.getByText(needle, { exact: false });
      if ((await loc.count()) > 0) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

async function locateMessageButton(page: Page, profileUrl: string) {
  const candidates = [
    page.getByRole("button", { name: /^Message$/i }),
    page.getByRole("button", { name: /^Mensagem$/i }),
    page.getByRole("button", { name: /^Mensaje$/i }),
    page.locator('button:has-text("Message")'),
    page.locator('button:has-text("Mensagem")'),
    page.locator('button:has-text("Mensaje")'),
    page.locator('a:has-text("Message")'),
    page.locator('a:has-text("Mensagem")'),
  ];

  let combined = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    combined = combined!.or(candidates[i]!);
  }

  const button = combined!.first();
  try {
    await button.waitFor({ state: "visible", timeout: LOCATOR_TIMEOUT });
  } catch {
    throw new LinkedInProfileNotFoundError(
      profileUrl,
      "botao de mensagem nao localizado",
    );
  }
  return button;
}

async function runInContext(
  ctx: BrowserContext,
  profileUrl: string,
  body: string,
): Promise<{ externalThreadId: string; latencyMs: number }> {
  const started = Date.now();
  const page = await ctx.newPage();

  await page.goto(profileUrl, {
    waitUntil: "domcontentloaded",
    timeout: LOCATOR_TIMEOUT,
  });

  if (await detectNeedsLogin(page)) {
    throw new LinkedInNeedsReloginError();
  }

  if (await detectProfileNotFound(page)) {
    throw new LinkedInProfileNotFoundError(profileUrl, "pagina indisponivel");
  }

  if (await detectRateLimit(page)) {
    throw new LinkedInBlockedError(
      "LinkedIn aplicou rate limit (pagina de perfil)",
    );
  }

  await humanDelay(3500, 8000);

  const button = await locateMessageButton(page, profileUrl);
  await humanScroll(page);
  const box = await button.boundingBox();
  await humanMoveTo(page, box);

  try {
    await button.click({ timeout: LOCATOR_TIMEOUT });
  } catch {
    throw new LinkedInProfileNotFoundError(
      profileUrl,
      "falha ao clicar no botao de mensagem",
    );
  }

  const textbox = page
    .locator('div[role="textbox"][contenteditable="true"]')
    .or(page.locator('div[contenteditable="true"][role="textbox"]'))
    .or(page.locator('.msg-form__contenteditable[contenteditable="true"]'))
    .first();

  try {
    await textbox.waitFor({ state: "visible", timeout: LOCATOR_TIMEOUT });
  } catch {
    if (await detectRateLimit(page)) {
      throw new LinkedInBlockedError(
        "LinkedIn aplicou rate limit ao abrir DM",
      );
    }
    throw new LinkedInBlockedError("campo de mensagem nao apareceu");
  }

  await humanDelay(1500, 3500);

  try {
    await textbox.click({ timeout: LOCATOR_TIMEOUT });
  } catch {
    throw new LinkedInBlockedError("falha ao focar no campo de mensagem");
  }

  await typeHumanLike(page, body);
  await humanDelay(200, 600);

  const sendButton = page
    .getByRole("button", { name: /^Send$/i })
    .or(page.getByRole("button", { name: /^Enviar$/i }))
    .or(page.locator('button.msg-form__send-button'))
    .or(page.locator('button:has-text("Send")'))
    .or(page.locator('button:has-text("Enviar")'));

  try {
    await sendButton.first().click({ timeout: 3000 });
  } catch {
    await page.keyboard.press("Enter");
  }

  const sentNeedle = body.slice(0, Math.min(20, body.length));
  try {
    await page
      .locator(`xpath=//div[contains(text(), ${JSON.stringify(sentNeedle)})]`)
      .first()
      .waitFor({ state: "visible", timeout: LOCATOR_TIMEOUT });
  } catch {
    if (await detectRateLimit(page)) {
      throw new LinkedInBlockedError(
        "LinkedIn aplicou rate limit ao enviar DM",
      );
    }
    throw new LinkedInBlockedError("mensagem nao aparece na conversa");
  }

  if (await detectRateLimit(page)) {
    throw new LinkedInBlockedError("LinkedIn aplicou rate limit apos envio");
  }

  let externalThreadId = "";
  const url = page.url();
  const match = url.match(/messaging\/thread\/([^/?#]+)/);
  if (match && match[1]) {
    externalThreadId = match[1];
  }

  // pequena pausa de encerramento
  await humanDelay(400, 1000);
  // usa randomInt so pra manter import estavel se nao usar acima
  void randomInt;

  return {
    externalThreadId,
    latencyMs: Date.now() - started,
  };
}

export type LinkedInConnectResult = {
  status: "sent" | "already";
  latencyMs: number;
};

// Envia CONVITE DE CONEXAO (com nota opcional) para um perfil ainda nao
// conectado. Fluxo: abre o perfil, clica "Conectar" (direto ou dentro do menu
// "Mais"), "Adicionar nota", digita a nota e envia. Se ja for conexao/pendente,
// retorna "already" sem erro. Todo o ritmo e humanizado (anti-deteccao).
async function runConnectInContext(
  ctx: BrowserContext,
  profileUrl: string,
  note: string,
): Promise<LinkedInConnectResult> {
  const started = Date.now();
  const page = await ctx.newPage();

  await page.goto(profileUrl, {
    waitUntil: "domcontentloaded",
    timeout: LOCATOR_TIMEOUT,
  });

  if (await detectNeedsLogin(page)) throw new LinkedInNeedsReloginError();
  if (await detectProfileNotFound(page)) {
    throw new LinkedInProfileNotFoundError(profileUrl, "pagina indisponivel");
  }
  if (await detectRateLimit(page)) {
    throw new LinkedInBlockedError("LinkedIn aplicou rate limit (perfil)");
  }

  await humanDelay(3500, 8000);
  await humanScroll(page);

  // Ja e conexao ou convite pendente? Nesse caso nao reenvia.
  const jaRelacionado = page
    .getByRole("button", { name: /^(Pending|Pendente|Message|Mensagem|Mensaje)$/i })
    .first();
  if ((await jaRelacionado.count()) > 0 && (await jaRelacionado.isVisible().catch(() => false))) {
    return { status: "already", latencyMs: Date.now() - started };
  }

  // Botao "Conectar": as vezes direto no perfil, as vezes dentro do menu "Mais".
  const connectDirect = page
    .getByRole("button", { name: /^(Connect|Conectar|Conectarse)$/i })
    .first();
  let connectBtn = connectDirect;
  const temDireto =
    (await connectDirect.count()) > 0 &&
    (await connectDirect.isVisible().catch(() => false));

  if (!temDireto) {
    const moreBtn = page
      .getByRole("button", { name: /^(More|Mais|Mas)( actions)?$/i })
      .first();
    if ((await moreBtn.count()) > 0) {
      await humanMoveTo(page, await moreBtn.boundingBox());
      await moreBtn.click({ timeout: LOCATOR_TIMEOUT }).catch(() => {});
      await humanDelay(700, 1600);
      connectBtn = page
        .getByRole("menuitem", { name: /(Connect|Conectar)/i })
        .or(page.locator('div[role="button"]:has-text("Conectar")'))
        .or(page.locator('div[role="button"]:has-text("Connect")'))
        .first();
    }
  }

  try {
    await connectBtn.waitFor({ state: "visible", timeout: LOCATOR_TIMEOUT });
  } catch {
    throw new LinkedInProfileNotFoundError(profileUrl, "botao Conectar nao encontrado");
  }

  await humanMoveTo(page, await connectBtn.boundingBox());
  await connectBtn.click({ timeout: LOCATOR_TIMEOUT });
  await humanDelay(1000, 2500);

  // Modal do convite: adicionar nota (LinkedIn limita ~300 caracteres).
  const noteTrim = note.trim().slice(0, 290);
  if (noteTrim) {
    const addNote = page
      .getByRole("button", { name: /(Add a note|Adicionar nota|Anadir nota)/i })
      .first();
    if ((await addNote.count()) > 0 && (await addNote.isVisible().catch(() => false))) {
      await addNote.click({ timeout: LOCATOR_TIMEOUT }).catch(() => {});
      await humanDelay(800, 1800);
      const noteBox = page
        .locator('textarea[name="message"]')
        .or(page.locator("textarea#custom-message"))
        .or(page.locator('textarea[id*="message"]'))
        .or(page.locator("textarea"))
        .first();
      try {
        await noteBox.waitFor({ state: "visible", timeout: LOCATOR_TIMEOUT });
        await noteBox.click({ timeout: LOCATOR_TIMEOUT });
        await typeHumanLike(page, noteTrim);
        await humanDelay(300, 800);
      } catch {
        // sem campo de nota, segue sem ela
      }
    }
  }

  const sendBtn = page
    .getByRole("button", { name: /^(Send|Enviar|Send invitation|Enviar convite)$/i })
    .or(page.locator('button[aria-label*="Send now"]'))
    .or(page.locator('button[aria-label*="Enviar"]'))
    .or(page.locator('button:has-text("Enviar")'))
    .first();
  try {
    await sendBtn.click({ timeout: LOCATOR_TIMEOUT });
  } catch {
    throw new LinkedInBlockedError("botao Enviar do convite nao encontrado");
  }

  await humanDelay(1500, 3000);
  if (await detectRateLimit(page)) {
    throw new LinkedInBlockedError("LinkedIn aplicou rate limit apos o convite");
  }
  void randomInt;
  return { status: "sent", latencyMs: Date.now() - started };
}

export async function sendLinkedInConnection(params: {
  organizationId: string;
  profileUrl: string;
  note: string;
}): Promise<LinkedInConnectResult> {
  const { organizationId, profileUrl, note } = params;

  const session = await loadBrowserSession(organizationId, "linkedin_session");
  if (!session) throw new LinkedInNeedsReloginError();

  const payload: BrowserSessionPayload = {
    storageState: session.storageState,
    profileUsername: session.profileUsername,
    savedAt: session.savedAt,
    sessionCreatedAt: session.sessionCreatedAt,
    userAgent: session.userAgent,
    viewport: session.viewport,
  };

  const { result, newStorageState } = await withBrowser(payload, (ctx) =>
    runConnectInContext(ctx, profileUrl, note),
  );

  await saveBrowserSession(organizationId, "linkedin_session", {
    storageState: newStorageState,
    profileUsername: session.profileUsername,
    savedAt: Date.now(),
    sessionCreatedAt: session.sessionCreatedAt,
    userAgent: session.userAgent,
    viewport: session.viewport,
  });

  return result;
}

export async function sendLinkedInDM(params: {
  organizationId: string;
  profileUrl: string;
  body: string;
}): Promise<{ externalThreadId: string; latencyMs: number }> {
  const { organizationId, profileUrl, body } = params;

  const session = await loadBrowserSession(organizationId, "linkedin_session");
  if (!session) {
    throw new LinkedInNeedsReloginError();
  }

  const payload: BrowserSessionPayload = {
    storageState: session.storageState,
    profileUsername: session.profileUsername,
    savedAt: session.savedAt,
    sessionCreatedAt: session.sessionCreatedAt,
    userAgent: session.userAgent,
    viewport: session.viewport,
  };

  const { result, newStorageState } = await withBrowser(payload, (ctx) =>
    runInContext(ctx, profileUrl, body),
  );

  // sessionCreatedAt e preservado dentro de saveBrowserSession,
  // repassamos o valor atual apenas para satisfazer o tipo
  await saveBrowserSession(organizationId, "linkedin_session", {
    storageState: newStorageState,
    profileUsername: session.profileUsername,
    savedAt: Date.now(),
    sessionCreatedAt: session.sessionCreatedAt,
    userAgent: session.userAgent,
    viewport: session.viewport,
  });

  return result;
}
