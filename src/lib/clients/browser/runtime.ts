import "server-only";
import { chromium, type BrowserContext } from "playwright";

export type BrowserStorageState = Awaited<
  ReturnType<BrowserContext["storageState"]>
>;

export type BrowserSessionPayload = {
  storageState: BrowserStorageState;
  profileUsername: string;
  savedAt: number;
  sessionCreatedAt: number;
  userAgent: string;
  viewport: { width: number; height: number };
};

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

const USER_AGENT_POOL: string[] = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
];

const VIEWPORT_POOL: Array<{ width: number; height: number }> = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
];

function hashSeed(seed: string): number {
  let sum = 0;
  for (let i = 0; i < seed.length; i++) {
    sum = (sum + seed.charCodeAt(i)) >>> 0;
  }
  return sum;
}

export function pickUserAgent(seed: string): string {
  const idx = hashSeed(seed) % USER_AGENT_POOL.length;
  return USER_AGENT_POOL[idx] ?? DEFAULT_USER_AGENT;
}

export function pickViewport(seed: string): { width: number; height: number } {
  const idx = hashSeed(seed) % VIEWPORT_POOL.length;
  return VIEWPORT_POOL[idx] ?? DEFAULT_VIEWPORT;
}

export type WithBrowserOverrides = {
  userAgent?: string;
  viewport?: { width: number; height: number };
};

export async function withBrowser<T>(
  session: BrowserSessionPayload,
  fn: (ctx: BrowserContext) => Promise<T>,
  overrides?: WithBrowserOverrides,
): Promise<{ result: T; newStorageState: BrowserStorageState }> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });
  try {
    const context = await browser.newContext({
      storageState: session.storageState,
      userAgent: overrides?.userAgent || session.userAgent || DEFAULT_USER_AGENT,
      viewport: overrides?.viewport ?? session.viewport ?? DEFAULT_VIEWPORT,
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      geolocation: { latitude: -23.55, longitude: -46.63 },
      permissions: ["geolocation"],
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });

      Object.defineProperty(navigator, "languages", {
        get: () => ["pt-BR", "pt", "en-US"],
      });

      const fakePlugins = [
        { name: "Chrome PDF Plugin", description: "Portable Document Format" },
        { name: "Chrome PDF Viewer", description: "" },
        { name: "Native Client", description: "" },
      ];
      Object.defineProperty(navigator, "plugins", {
        get: () => {
          const arr = fakePlugins.slice();
          Object.defineProperty(arr, "length", { value: 3 });
          return arr;
        },
      });

      (window as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome = {
        runtime: {},
      };

      const permissions = navigator.permissions as unknown as {
        query: (p: { name: string }) => Promise<{ state: string }>;
      };
      const originalQuery = permissions.query?.bind(navigator.permissions);
      permissions.query = (parameters: { name: string }) => {
        if (parameters && parameters.name === "notifications") {
          return Promise.resolve({ state: "granted" });
        }
        return originalQuery
          ? originalQuery(parameters)
          : Promise.resolve({ state: "granted" });
      };
    });

    try {
      const result = await fn(context);
      const newStorageState = await context.storageState();
      return { result, newStorageState };
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}
