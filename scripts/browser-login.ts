import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

if (existsSync(resolve(process.cwd(), ".env.local"))) {
  loadEnv({ path: ".env.local" });
} else {
  loadEnv();
}

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";
import {
  DEFAULT_USER_AGENT,
  DEFAULT_VIEWPORT,
} from "@/lib/clients/browser/runtime";
import { saveBrowserSession } from "@/lib/clients/browser/storage";

type ProviderArg = "instagram" | "linkedin";

type Config = {
  provider: ProviderArg;
  sessionProvider: "instagram_session" | "linkedin_session";
  loginUrl: string;
  cookieName: string;
  cookieDomainHint: string;
};

const CONFIGS: Record<ProviderArg, Config> = {
  instagram: {
    provider: "instagram",
    sessionProvider: "instagram_session",
    loginUrl: "https://www.instagram.com/accounts/login/",
    cookieName: "sessionid",
    cookieDomainHint: "instagram.com",
  },
  linkedin: {
    provider: "linkedin",
    sessionProvider: "linkedin_session",
    loginUrl: "https://www.linkedin.com/login",
    cookieName: "li_at",
    cookieDomainHint: "linkedin.com",
  },
};

function parseArgs(): { provider: ProviderArg; organizationId: string; username?: string } {
  const args = process.argv.slice(2);
  let provider: string | null = null;
  let organizationId: string | null = null;
  let username: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--provider") {
      provider = args[++i] ?? null;
    } else if (arg === "--org") {
      organizationId = args[++i] ?? null;
    } else if (arg === "--username") {
      username = args[++i] ?? null;
    }
  }
  if (!provider || (provider !== "instagram" && provider !== "linkedin")) {
    throw new Error("use: --provider instagram|linkedin");
  }
  if (!organizationId) {
    throw new Error("use: --org <organizationId>");
  }
  return { provider: provider as ProviderArg, organizationId, username: username ?? undefined };
}

async function waitForLogin(config: Config, contextCookies: () => Promise<unknown[]>) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const cookies = (await contextCookies()) as Array<{
      name: string;
      domain: string;
      value: string;
    }>;
    const match = cookies.find(
      (c) =>
        c.name === config.cookieName &&
        c.domain.includes(config.cookieDomainHint) &&
        c.value.length > 0,
    );
    if (match) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

async function main() {
  const { provider, organizationId, username: usernameArg } = parseArgs();
  const config = CONFIGS[provider];

  console.log(
    `[browser-login] abrindo navegador para ${provider}, faca login manualmente`,
  );

  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext({
      userAgent: DEFAULT_USER_AGENT,
      viewport: DEFAULT_VIEWPORT,
      locale: "pt-BR",
    });
    const page = await context.newPage();
    await page.goto(config.loginUrl, { waitUntil: "domcontentloaded" });

    console.log(
      `[browser-login] aguardando cookie ${config.cookieName}, limite 10 minutos`,
    );
    const ok = await waitForLogin(config, () => context.cookies());
    if (!ok) {
      throw new Error("timeout aguardando login");
    }

    const storageState = await context.storageState();

    let profileUsername: string;
    if (usernameArg) {
      profileUsername = usernameArg.trim();
    } else {
      const rl = createInterface({ input, output });
      profileUsername = (await rl.question("informe o profileUsername: ")).trim();
      rl.close();
    }
    if (!profileUsername) {
      throw new Error("profileUsername vazio");
    }

    const now = Date.now();
    await saveBrowserSession(organizationId, config.sessionProvider, {
      storageState,
      profileUsername,
      savedAt: now,
      sessionCreatedAt: now,
      userAgent: DEFAULT_USER_AGENT,
      viewport: DEFAULT_VIEWPORT,
    });

    console.log(`sessao ${provider} salva com sucesso`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[browser-login] erro:", err instanceof Error ? err.message : err);
  process.exit(1);
});
