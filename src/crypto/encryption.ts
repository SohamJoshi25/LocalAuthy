import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface EncryptedPayload {
  iv: string;
  authTag: string;
  data: string;
}

export function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, "base64")), decipher.final()]).toString("utf8");
}
