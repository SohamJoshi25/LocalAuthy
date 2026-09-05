import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import { decrypt, encrypt, type EncryptedPayload } from "../crypto/encryption.js";
import { createSalt, deriveKey, KDF_ALGORITHM } from "../crypto/kdf.js";
import type { Account } from "../types/account.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

interface VaultFile {
  version: 1;
  updatedAt?: string;
  kdf: { algorithm: typeof KDF_ALGORITHM; salt: string };
  cipher: Omit<EncryptedPayload, "data">;
  data: string;
}

const filePath = path.resolve(process.cwd(), env.VAULT_FILE);
const sessions = new Map<string, Buffer>();
let writeQueue = Promise.resolve();

async function exists(): Promise<boolean> {
  try {
    await fs.access(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }

  const raw = await fs.readFile(filePath, "utf8");
  return raw.trim().length > 0;
}

async function readFile(): Promise<VaultFile> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || (parsed as VaultFile).version !== 1) {
    throw new Error("Invalid vault format");
  }
  return parsed as VaultFile;
}

async function writeFile(file: VaultFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

function queueWrite(file: VaultFile): Promise<void> {
  writeQueue = writeQueue.then(() => writeFile(file));
  return writeQueue;
}

function tokenFor(key: Buffer): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, key);
  return token;
}

function keyFor(token: string | undefined): Buffer {
  const key = token ? sessions.get(token) : undefined;
  if (!key) throw new AppError(401, "Vault is locked or the session is invalid");
  return key;
}

export async function vaultExists(): Promise<boolean> {
  return exists();
}

export async function createVault(password: string): Promise<void> {
  if (await exists()) throw new AppError(409, "Vault already exists");

  const salt = createSalt();
  const key = deriveKey(password, salt);
  const payload = encrypt(JSON.stringify([]), key);
  const now = new Date().toISOString();

  await writeFile({
    version: 1,
    updatedAt: now,
    kdf: { algorithm: KDF_ALGORITHM, salt: salt.toString("base64") },
    cipher: { iv: payload.iv, authTag: payload.authTag },
    data: payload.data,
  });

  logger.success("VAULT", "Vault created", { vaultFile: filePath, updatedAt: now });
}

export async function unlockVault(password: string): Promise<string> {
  if (!(await exists())) throw new AppError(404, "Vault has not been created");

  try {
    const file = await readFile();
    const key = deriveKey(password, Buffer.from(file.kdf.salt, "base64"));
    decrypt({ iv: file.cipher.iv, authTag: file.cipher.authTag, data: file.data }, key);
    const token = tokenFor(key);
    logger.success("VAULT", "Vault unlocked", { vaultFile: filePath });
    return token;
  } catch {
    logger.warn("VAULT", "Vault unlock failed", { vaultFile: filePath });
    throw new AppError(401, "Invalid master password or corrupted vault");
  }
}

export function lockVault(token?: string): void {
  if (token) sessions.delete(token);
  else sessions.clear();

  logger.info("VAULT", "Vault locked", { tokenPresent: Boolean(token) });
}

export function isUnlocked(token?: string): boolean {
  return Boolean(token && sessions.has(token));
}

async function accountsFor(key: Buffer): Promise<Account[]> {
  const file = await readFile();
  const parsed: unknown = JSON.parse(decrypt({ iv: file.cipher.iv, authTag: file.cipher.authTag, data: file.data }, key));

  if (!Array.isArray(parsed)) {
    throw new Error("Vault data must be an array");
  }

  return parsed as Account[];
}

async function saveAccounts(accounts: Account[], key: Buffer): Promise<void> {
  const file = await readFile();
  const payload = encrypt(JSON.stringify(accounts), key);
  const updatedAt = new Date().toISOString();
  await queueWrite({ ...file, updatedAt, cipher: { iv: payload.iv, authTag: payload.authTag }, data: payload.data });
}

export async function getVaultStatus(token?: string): Promise<{ unlocked: boolean; modifiedAt: string | null }> {
  const unlocked = isUnlocked(token);

  if (!(await exists())) {
    return { unlocked, modifiedAt: null };
  }

  try {
    const file = await readFile();
    return { unlocked, modifiedAt: file.updatedAt ?? null };
  } catch {
    const stat = await fs.stat(filePath);
    return { unlocked, modifiedAt: new Date(stat.mtimeMs).toISOString() };
  }
}

export async function listAccounts(token: string | undefined): Promise<Account[]> {
  return accountsFor(keyFor(token));
}

export async function findAccount(id: string, token: string | undefined): Promise<Account | undefined> {
  return (await accountsFor(keyFor(token))).find((account) => account.id === id);
}

export async function createAccount(
  input: Omit<Account, "id" | "createdAt" | "updatedAt">,
  token: string | undefined,
): Promise<Account> {
  const key = keyFor(token);
  const accounts = await accountsFor(key);
  const now = new Date().toISOString();
  const account: Account = {
    ...input,
    id: randomBytes(16).toString("hex"),
    createdAt: now,
    updatedAt: now,
  };

  await saveAccounts([...accounts, account], key);
  return account;
}

export async function updateAccount(
  id: string,
  input: Partial<Omit<Account, "id" | "createdAt" | "updatedAt">>,
  token: string | undefined,
): Promise<Account> {
  const key = keyFor(token);
  const accounts = await accountsFor(key);
  const index = accounts.findIndex((account) => account.id === id);

  if (index === -1) {
    throw new AppError(404, "Account not found");
  }

  const updated = {
    ...accounts[index],
    ...input,
    updatedAt: new Date().toISOString(),
  };

  accounts[index] = updated;
  await saveAccounts(accounts, key);
  return updated;
}

export async function deleteAccount(id: string, token: string | undefined): Promise<boolean> {
  const key = keyFor(token);
  const accounts = await accountsFor(key);
  const remaining = accounts.filter((account) => account.id !== id);

  if (remaining.length === accounts.length) return false;

  await saveAccounts(remaining, key);
  return true;
}
