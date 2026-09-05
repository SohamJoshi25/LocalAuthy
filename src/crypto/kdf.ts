import { randomBytes, scryptSync } from "node:crypto";

export const KDF_ALGORITHM = "scrypt" as const;
export const KEY_LENGTH = 32;

export function createSalt(): Buffer {
  return randomBytes(16);
}

export function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH);
}
