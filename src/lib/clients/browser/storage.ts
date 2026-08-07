import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { credentials } from "@/db/schema/credentials";
import {
  decryptCredential,
  encryptCredential,
} from "@/lib/crypto/credentials";
import {
  DEFAULT_USER_AGENT,
  DEFAULT_VIEWPORT,
  type BrowserSessionPayload,
  type BrowserStorageState,
} from "./runtime";

export type BrowserSessionProvider = "instagram_session" | "linkedin_session";

type StoredBrowserSession = {
  storageState: BrowserStorageState;
  profileUsername: string;
  savedAt: number;
  sessionCreatedAt: number;
  userAgent: string;
  viewport: { width: number; height: number };
  metadata?: Record<string, unknown>;
};

export type LoadedBrowserSession = {
  id: string;
  storageState: BrowserStorageState;
  profileUsername: string;
  savedAt: number;
  sessionCreatedAt: number;
  userAgent: string;
  viewport: { width: number; height: number };
};

async function loadCredentialRow(
  organizationId: string,
  provider: BrowserSessionProvider,
) {
  const rows = await db
    .select()
    .from(credentials)
    .where(
      and(
        eq(credentials.organizationId, organizationId),
        eq(credentials.provider, provider),
      ),
    )
    .orderBy(desc(credentials.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function loadBrowserSession(
  organizationId: string,
  provider: BrowserSessionProvider,
): Promise<LoadedBrowserSession | null> {
  const row = await loadCredentialRow(organizationId, provider);
  if (!row) return null;
  try {
    const payload = await decryptCredential<StoredBrowserSession>(
      row.ciphertext,
    );
    if (!payload.storageState || !payload.profileUsername) return null;
    const needsRelogin = Boolean(
      payload.metadata &&
        (payload.metadata as Record<string, unknown>).needs_relogin === true,
    );
    if (needsRelogin) return null;
    const sessionCreatedAt =
      typeof payload.sessionCreatedAt === "number"
        ? payload.sessionCreatedAt
        : payload.savedAt;
    return {
      id: row.id,
      storageState: payload.storageState,
      profileUsername: payload.profileUsername,
      savedAt: payload.savedAt,
      sessionCreatedAt,
      userAgent: payload.userAgent || DEFAULT_USER_AGENT,
      viewport: payload.viewport ?? DEFAULT_VIEWPORT,
    };
  } catch {
    return null;
  }
}

export async function saveBrowserSession(
  organizationId: string,
  provider: BrowserSessionProvider,
  payload: BrowserSessionPayload,
): Promise<string> {
  const now = Date.now();
  const existing = await loadCredentialRow(organizationId, provider);

  // preserva sessionCreatedAt antigo se ja existir credential, caso contrario usa now
  let sessionCreatedAt = now;
  if (existing) {
    try {
      const previous = await decryptCredential<StoredBrowserSession>(
        existing.ciphertext,
      );
      if (typeof previous.sessionCreatedAt === "number") {
        sessionCreatedAt = previous.sessionCreatedAt;
      } else if (typeof previous.savedAt === "number") {
        // fallback para credentials antigas sem sessionCreatedAt
        sessionCreatedAt = previous.savedAt;
      }
    } catch {
      // se nao conseguir decriptar o anterior, trata como primeira gravacao
      sessionCreatedAt = now;
    }
  }

  const stored: StoredBrowserSession = {
    storageState: payload.storageState,
    profileUsername: payload.profileUsername,
    savedAt: now,
    sessionCreatedAt,
    userAgent: payload.userAgent,
    viewport: payload.viewport,
  };
  const ciphertext = await encryptCredential(
    stored as unknown as Record<string, unknown>,
  );

  if (existing) {
    await db
      .update(credentials)
      .set({
        ciphertext,
        label: payload.profileUsername,
        updatedAt: new Date(),
      })
      .where(eq(credentials.id, existing.id));
    return existing.id;
  }
  const inserted = await db
    .insert(credentials)
    .values({
      organizationId,
      provider,
      label: payload.profileUsername,
      ciphertext,
    })
    .returning({ id: credentials.id });
  const row = inserted[0];
  if (!row) throw new Error(`falha ao salvar credential ${provider}`);
  return row.id;
}

export type BrowserSessionStatus = {
  id: string;
  provider: BrowserSessionProvider;
  profileUsername: string;
  savedAt: Date;
  needsRelogin: boolean;
};

export async function getBrowserSessionStatus(
  organizationId: string,
  provider: BrowserSessionProvider,
): Promise<BrowserSessionStatus | null> {
  const row = await loadCredentialRow(organizationId, provider);
  if (!row) return null;
  try {
    const payload = await decryptCredential<StoredBrowserSession>(
      row.ciphertext,
    );
    if (!payload.profileUsername) return null;
    const needsRelogin = Boolean(
      payload.metadata && (payload.metadata as Record<string, unknown>).needs_relogin,
    );
    return {
      id: row.id,
      provider,
      profileUsername: payload.profileUsername,
      savedAt: new Date(payload.savedAt),
      needsRelogin,
    };
  } catch {
    return null;
  }
}

export async function markBrowserSessionStale(
  organizationId: string,
  provider: BrowserSessionProvider,
): Promise<void> {
  const row = await loadCredentialRow(organizationId, provider);
  if (!row) return;
  try {
    const payload = await decryptCredential<StoredBrowserSession>(
      row.ciphertext,
    );
    const metadata: Record<string, unknown> = {
      ...(payload.metadata ?? {}),
      needs_relogin: true,
      marked_stale_at: Date.now(),
    };
    const updated: StoredBrowserSession = { ...payload, metadata };
    const ciphertext = await encryptCredential(
      updated as unknown as Record<string, unknown>,
    );
    await db
      .update(credentials)
      .set({ ciphertext, updatedAt: new Date() })
      .where(eq(credentials.id, row.id));
  } catch {
    // sem decrypt valida, nao marca
  }
}
