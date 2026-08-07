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

export class InstagramBlockedError extends Error {
  constructor(message = "Instagram bloqueou a sessao") {
    super(message);
    this.name = "InstagramBlockedError";
  }
}

export class InstagramNeedsReloginError extends Error {
  constructor(message = "Instagram precisa de novo login") {
    super(message);
    this.name = "InstagramNeedsReloginError";
  }
}

export class InstagramHandleNotFoundError extends Error {
  constructor(handle: string, detail?: string) {
    super(
      `Instagram handle ${handle} nao encontrado${
        detail ? `, detalhe, ${detail}` : ""
      }`,
    );
    this.name = "InstagramHandleNotFoundError";
  }
}

const LOCATOR_TIMEOUT = 15000;

async function locateMessageButton(page: Page, handle: string) {
  const candidates = [
    page.getByRole("button", { name: /^Message$/i }),
    page.getByRole("button", { name: /^Mensagem$/i }),
    page.getByRole("button", { name: /Enviar mensaje/i }),
    page.locator('div[role="button"]:has-text("Message")'),
    page.locator('div[role="button"]:has-text("Mensagem")'),
    page.locator('div[role="button"]:has-text("Enviar mensaje")'),
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
    throw new InstagramHandleNotFoundError(
      handle,
      "botao de mensagem nao localizado",
    );
  }
  return button;
}

async function detectNotFound(page: Page): Promise<boolean> {
  const needles = [
    "Sorry, this page isn't available",
    "Esta pagina nao esta disponivel",
    "Lamentamos, pero no podemos encontrar la pagina",
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
    "Try Again Later",
    "Tente novamente mais tarde",
    "We limit how often",
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

async function runInContext(
  ctx: BrowserContext,
  handle: string,
  body: string,
): Promise<{ externalThreadId: string; latencyMs: number }> {
  const started = Date.now();
  const page = await ctx.newPage();

  await page.goto(`https://www.instagram.com/${handle}/`, {
    waitUntil: "domcontentloaded",
    timeout: LOCATOR_TIMEOUT,
  });

  if (/\/accounts\/login/i.test(page.url())) {
    throw new InstagramNeedsReloginError();
  }

  if (await detectNotFound(page)) {
    throw new InstagramHandleNotFoundError(handle, "pagina indisponivel");
  }

  if (await detectRateLimit(page)) {
    throw new InstagramBlockedError(
      "Instagram aplicou rate limit (pagina de perfil)",
    );
  }

  await humanDelay(3500, 8000);

  const button = await locateMessageButton(page, handle);
  await humanScroll(page);
  const box = await button.boundingBox();
  await humanMoveTo(page, box);

  try {
    await button.click({ timeout: LOCATOR_TIMEOUT });
  } catch {
    throw new InstagramHandleNotFoundError(
      handle,
      "falha ao clicar no botao de mensagem",
    );
  }

  const textbox = page
    .locator('div[role="textbox"][contenteditable="true"]')
    .or(page.locator('div[contenteditable="true"][role="textbox"]'))
    .first();

  try {
    await textbox.waitFor({ state: "visible", timeout: LOCATOR_TIMEOUT });
  } catch {
    if (await detectRateLimit(page)) {
      throw new InstagramBlockedError(
        "Instagram aplicou rate limit ao abrir DM",
      );
    }
    throw new InstagramBlockedError("campo de mensagem nao apareceu");
  }

  await page.mouse.wheel(0, -randomInt(200, 600));
  await humanDelay(1500, 3500);

  try {
    await textbox.click({ timeout: LOCATOR_TIMEOUT });
  } catch {
    throw new InstagramBlockedError("falha ao focar no campo de mensagem");
  }

  await typeHumanLike(page, body);
  await humanDelay(200, 600);

  const sendButton = page
    .getByRole("button", { name: /^Send$/i })
    .or(page.getByRole("button", { name: /^Enviar$/i }))
    .or(page.locator('div[role="button"]:has-text("Send")'))
    .or(page.locator('div[role="button"]:has-text("Enviar")'));

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
      throw new InstagramBlockedError(
        "Instagram aplicou rate limit ao enviar DM",
      );
    }
    throw new InstagramBlockedError("mensagem nao aparece na conversa");
  }

  if (await detectRateLimit(page)) {
    throw new InstagramBlockedError(
      "Instagram aplicou rate limit apos envio",
    );
  }

  let externalThreadId = "";
  const url = page.url();
  const match = url.match(/direct\/t\/([^/?#]+)/);
  if (match && match[1]) {
    externalThreadId = match[1];
  }

  return {
    externalThreadId,
    latencyMs: Date.now() - started,
  };
}

export async function sendInstagramDM(params: {
  organizationId: string;
  handle: string;
  body: string;
}): Promise<{ externalThreadId: string; latencyMs: number }> {
  const { organizationId, handle, body } = params;

  const session = await loadBrowserSession(organizationId, "instagram_session");
  if (!session) {
    throw new InstagramNeedsReloginError();
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
    runInContext(ctx, handle, body),
  );

  // sessionCreatedAt e preservado dentro de saveBrowserSession,
  // repassamos o valor atual apenas para satisfazer o tipo
  await saveBrowserSession(organizationId, "instagram_session", {
    storageState: newStorageState,
    profileUsername: session.profileUsername,
    savedAt: Date.now(),
    sessionCreatedAt: session.sessionCreatedAt,
    userAgent: session.userAgent,
    viewport: session.viewport,
  });

  return result;
}
