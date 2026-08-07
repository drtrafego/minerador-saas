import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  const secret = process.env.STACK_SECRET_SERVER_KEY ?? process.env.OAUTH_STATE_SECRET;
  if (!secret) {
    throw new Error("STACK_SECRET_SERVER_KEY nao definida (necessaria pra state OAuth)");
  }
  return secret;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(
    str.replace(/-/g, "+").replace(/_/g, "/") + pad,
    "base64",
  );
}

export type OAuthStatePayload = {
  orgId: string;
  userId: string;
  nonce: string;
  exp: number;
};

export function signState(payload: Omit<OAuthStatePayload, "nonce" | "exp">): string {
  const full: OAuthStatePayload = {
    ...payload,
    nonce: Math.random().toString(36).slice(2),
    exp: Date.now() + 10 * 60 * 1000,
  };
  const body = base64UrlEncode(Buffer.from(JSON.stringify(full), "utf-8"));
  const sig = base64UrlEncode(
    createHmac("sha256", getSecret()).update(body).digest(),
  );
  return `${body}.${sig}`;
}

export function verifyState(state: string): OAuthStatePayload | null {
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];

  const expected = base64UrlEncode(
    createHmac("sha256", getSecret()).update(body).digest(),
  );
  const sigBuf = base64UrlDecode(sig);
  const expBuf = base64UrlDecode(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;

  try {
    const payload = JSON.parse(
      base64UrlDecode(body).toString("utf-8"),
    ) as OAuthStatePayload;
    if (!payload.orgId || !payload.userId) return null;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
