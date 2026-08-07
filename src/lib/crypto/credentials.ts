import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const envKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!envKey) {
    throw new Error("CREDENTIALS_ENCRYPTION_KEY nao definida");
  }
  // deriva 32 bytes estaveis via sha256, nao depende do formato da env var
  return createHash("sha256").update(envKey, "utf8").digest();
}

export async function encryptCredential(
  payload: Record<string, unknown>,
): Promise<string> {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const plain = Buffer.from(JSON.stringify(payload), "utf8");
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${enc.toString("base64")}.${tag.toString(
    "base64",
  )}`;
}

export async function decryptCredential<T = Record<string, unknown>>(
  ciphertext: string,
): Promise<T> {
  if (typeof ciphertext !== "string") {
    throw new Error("ciphertext deve ser string");
  }
  const parts = ciphertext.split(".");
  if (parts.length !== 3) {
    throw new Error("ciphertext em formato invalido");
  }
  const [ivB64, dataB64, tagB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error("ciphertext com iv ou tag invalidos");
  }
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(dec.toString("utf8")) as T;
}
