import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  type WASocket,
  type AuthenticationCreds,
  type SignalKeyStore,
  type BaileysEventMap,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { db } from "@/lib/db/node";
import { credentials } from "@/db/schema/credentials";
import { decryptCredential, encryptCredential } from "@/lib/crypto/credentials";
import { eq, and, desc } from "drizzle-orm";

type WhatsAppQRSession = {
  phoneNumber: string;
  savedAt: number;
  creds: AuthenticationCreds;
  keys: Record<string, Record<string, unknown>>;
};

export class WhatsAppNotConnectedError extends Error {
  constructor() {
    super("sessao WhatsApp nao conectada — rode pnpm whatsapp:login");
    this.name = "WhatsAppNotConnectedError";
  }
}

export class WhatsAppPhoneNotFoundError extends Error {
  constructor(phone: string) {
    super(`numero WhatsApp nao encontrado: ${phone}`);
    this.name = "WhatsAppPhoneNotFoundError";
  }
}

async function loadSession(
  organizationId: string,
): Promise<WhatsAppQRSession | null> {
  const row = await db.query.credentials.findFirst({
    where: and(
      eq(credentials.organizationId, organizationId),
      eq(credentials.provider, "whatsapp_session"),
    ),
    orderBy: desc(credentials.createdAt),
  });
  if (!row) return null;
  try {
    return await decryptCredential<WhatsAppQRSession>(row.ciphertext);
  } catch {
    return null;
  }
}

async function saveSession(
  organizationId: string,
  session: WhatsAppQRSession,
): Promise<void> {
  const ciphertext = await encryptCredential(session);
  const existing = await db.query.credentials.findFirst({
    where: and(
      eq(credentials.organizationId, organizationId),
      eq(credentials.provider, "whatsapp_session"),
    ),
  });
  if (existing) {
    await db
      .update(credentials)
      .set({ ciphertext, updatedAt: new Date() })
      .where(eq(credentials.id, existing.id));
  } else {
    await db.insert(credentials).values({
      organizationId,
      provider: "whatsapp_session",
      label: `WhatsApp QR ${session.phoneNumber}`,
      ciphertext,
    });
  }
}

// Singleton sockets por organizationId
const sockets = new Map<string, WASocket>();

function buildAuthState(
  session: WhatsAppQRSession,
  onUpdate: (creds: AuthenticationCreds) => void,
): { creds: AuthenticationCreds; keys: SignalKeyStore } {
  const keysInMemory: Record<string, Record<string, unknown>> = {
    ...session.keys,
  };

  const keys: SignalKeyStore = {
    get: async (type, ids) => {
      const result: Record<string, unknown> = {};
      for (const id of ids) {
        const val = keysInMemory[type]?.[id];
        if (val !== undefined) result[id] = val;
      }
      return result as ReturnType<SignalKeyStore["get"]> extends Promise<infer T>
        ? T
        : never;
    },
    set: async (data) => {
      for (const [type, values] of Object.entries(data)) {
        keysInMemory[type] = { ...(keysInMemory[type] ?? {}), ...values };
      }
    },
    clear: async () => {
      for (const key of Object.keys(keysInMemory)) delete keysInMemory[key];
    },
  };

  return {
    creds: session.creds,
    keys,
  };
}

async function createSocket(
  organizationId: string,
  session: WhatsAppQRSession | null,
  onQR?: (qr: string) => void,
): Promise<WASocket> {
  const { version } = await fetchLatestBaileysVersion();

  const keysInMemory: Record<string, Record<string, unknown>> = session
    ? { ...session.keys }
    : {};

  let currentCreds = session?.creds;

  const auth = session
    ? buildAuthState(session, (c) => {
        currentCreds = c;
      })
    : undefined;

  const socket = makeWASocket({
    version,
    printQRInTerminal: !onQR,
    auth: auth as Parameters<typeof makeWASocket>[0]["auth"],
    browser: ["Minerador", "Chrome", "120.0"],
  });

  sockets.set(organizationId, socket);

  socket.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && onQR) onQR(qr);

    if (connection === "open") {
      const phoneNumber =
        socket.user?.id.split(":")[0] ?? session?.phoneNumber ?? "desconhecido";
      await saveSession(organizationId, {
        phoneNumber,
        savedAt: Date.now(),
        creds: currentCreds!,
        keys: keysInMemory,
      });
    }

    if (connection === "close") {
      sockets.delete(organizationId);
      const shouldReconnect =
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut;
      if (shouldReconnect) {
        setTimeout(async () => {
          const freshSession = await loadSession(organizationId);
          await createSocket(organizationId, freshSession);
        }, 5000);
      }
    }
  });

  socket.ev.on("creds.update", async (update) => {
    currentCreds = { ...currentCreds!, ...update };
    const phoneNumber =
      socket.user?.id.split(":")[0] ?? session?.phoneNumber ?? "desconhecido";
    await saveSession(organizationId, {
      phoneNumber,
      savedAt: Date.now(),
      creds: currentCreds,
      keys: keysInMemory,
    });
  });

  return socket;
}

async function getOrCreateSocket(organizationId: string): Promise<WASocket> {
  const existing = sockets.get(organizationId);
  if (existing?.user) return existing;

  const session = await loadSession(organizationId);
  if (!session) throw new WhatsAppNotConnectedError();

  return createSocket(organizationId, session);
}

export async function sendWhatsAppQRMessage(params: {
  organizationId: string;
  phone: string;
  body: string;
}): Promise<{ messageId: string }> {
  const socket = await getOrCreateSocket(params.organizationId);
  const jid = params.phone.replace(/\D/g, "") + "@s.whatsapp.net";

  try {
    const result = await socket.sendMessage(jid, { text: params.body });
    if (!result?.key?.id) throw new WhatsAppPhoneNotFoundError(params.phone);
    return { messageId: result.key.id };
  } catch (err) {
    if (err instanceof WhatsAppPhoneNotFoundError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not-authorized") || msg.includes("bad-param")) {
      throw new WhatsAppPhoneNotFoundError(params.phone);
    }
    throw err;
  }
}

// Usado pelo script whatsapp-login.ts
export async function connectWithQR(
  organizationId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("timeout: QR nao escaneado em 5 minutos")),
      5 * 60 * 1000,
    );

    createSocket(organizationId, null, undefined).then((socket) => {
      socket.ev.on(
        "connection.update",
        (update: BaileysEventMap["connection.update"]) => {
          if (update.connection === "open") {
            clearTimeout(timeout);
            resolve();
          }
          if (update.connection === "close") {
            const loggedOut =
              (update.lastDisconnect?.error as Boom)?.output?.statusCode ===
              DisconnectReason.loggedOut;
            if (loggedOut) {
              clearTimeout(timeout);
              reject(new Error("QR escaneado mas login recusado"));
            }
          }
        },
      );
    });
  });
}

// Chamado no shutdown do worker
export async function closeAllWhatsAppSockets(): Promise<void> {
  for (const [orgId, socket] of sockets.entries()) {
    try {
      await socket.end(undefined);
    } catch {}
    sockets.delete(orgId);
  }
}
