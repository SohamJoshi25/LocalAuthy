import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { env } from "../config/env.js";
import type { Account } from "../types/account.js";

const filePath = path.resolve(process.cwd(), env.VAULT_FILE);
let writeQueue = Promise.resolve();

async function readAccounts(): Promise<Account[]> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (!raw.trim()) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("Vault must contain an array");
    return parsed as Account[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeAccounts(accounts: Account[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(accounts, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

function queueWrite(accounts: Account[]): Promise<void> {
  writeQueue = writeQueue.then(() => writeAccounts(accounts));
  return writeQueue;
}

export async function listAccounts(): Promise<Account[]> {
  return readAccounts();
}

export async function findAccount(id: string): Promise<Account | undefined> {
  return (await readAccounts()).find((account) => account.id === id);
}

export async function createAccount(input: Omit<Account, "id" | "createdAt" | "updatedAt">): Promise<Account> {
  const accounts = await readAccounts();
  const now = new Date().toISOString();
  const account: Account = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
  await queueWrite([...accounts, account]);
  return account;
}

export async function deleteAccount(id: string): Promise<boolean> {
  const accounts = await readAccounts();
  const remaining = accounts.filter((account) => account.id !== id);
  if (remaining.length === accounts.length) return false;
  await queueWrite(remaining);
  return true;
}
