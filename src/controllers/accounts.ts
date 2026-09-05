import { createHmac } from "node:crypto";
import type { RequestHandler } from "express";
import { generateSecret } from "otplib";
import { z } from "zod";
import { createAccount, deleteAccount, findAccount, listAccounts, updateAccount } from "../services/vault.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type { Account, PublicAccount } from "../types/account.js";

const accountInputSchema = z.object({
  issuer: z.string().trim().min(1).max(100),
  accountName: z.string().trim().min(1).max(200),
  secret: z.string().trim().min(1).max(256),
  algorithm: z.enum(["sha1", "sha256", "sha512"]).default("sha1"),
  digits: z.union([z.literal(6), z.literal(8)]).default(6),
  period: z.number().int().min(15).max(300).default(30),
});

const accountUpdateSchema = accountInputSchema.partial();
const idSchema = z.string().min(1).max(256);

function decodeBase32Secret(secret: string): Buffer {
  const cleaned = secret.trim().replace(/=+$/, "").toUpperCase();
  if (!cleaned) return Buffer.alloc(0);

  let bits = "";
  for (const char of cleaned) {
    const value = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(char);
    if (value === -1) throw new AppError(400, "Secret is not valid Base32 or raw secret data");
    bits += value.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

function decodeTotpSecret(secret: string): Buffer {
  const trimmed = secret.trim().replace(/\s+/g, "");
  if (!trimmed) throw new AppError(400, "TOTP secret is required");

  if (/^[A-Z2-7]+=*$/.test(trimmed.toUpperCase())) {
    return decodeBase32Secret(trimmed);
  }

  if (/^[0-9A-Fa-f]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return Buffer.from(trimmed, "hex");
  }

  return Buffer.from(trimmed, "utf8");
}

function generateTotpCode(secret: string, algorithm: Account["algorithm"], digits: number, period: number, counterOverride?: number): string {
  const key = decodeTotpSecret(secret);
  const counter = BigInt(counterOverride ?? Math.floor(Date.now() / 1000 / period));
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);

  const digest = createHmac(algorithm, key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  const code = binary % (10 ** digits);
  return code.toString().padStart(digits, "0");
}

function getTotpWindow(secret: string, algorithm: Account["algorithm"], digits: number, period: number) {
  const now = Date.now();
  const currentCounter = Math.floor(now / 1000 / period);
  const expiresAt = Math.ceil(now / (period * 1000)) * period * 1000;
  const remainingSeconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));

  return {
    code: generateTotpCode(secret, algorithm, digits, period, currentCounter),
    nextCode: generateTotpCode(secret, algorithm, digits, period, currentCounter + 1),
    expiresAt,
    remainingSeconds,
    period,
  };
}

function toPublicAccount({ secret: _secret, ...account }: Account): PublicAccount {
  return account;
}

export const list: RequestHandler = async (req, res, next) => {
  try {
    const accounts = await listAccounts(req.vaultToken);
    const publicAccounts = accounts.map((account) => ({
      ...toPublicAccount(account),
      ...getTotpWindow(account.secret, account.algorithm, account.digits, account.period),
    }));
    logger.info("TOTP", "Listed account metadata", { count: publicAccounts.length });
    res.json({ data: publicAccounts });
  } catch (error) { next(error); }
};

export const create: RequestHandler = async (req, res, next) => {
  try {
    const input = accountInputSchema.parse(req.body);
    const account = await createAccount(input, req.vaultToken);
    logger.success("TOTP", "Created account", { id: account.id, issuer: account.issuer, accountName: account.accountName });
    res.status(201).json({ data: toPublicAccount(account) });
  } catch (error) { next(error); }
};

export const update: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const input = accountUpdateSchema.parse(req.body);
    const account = await updateAccount(id, input, req.vaultToken);
    logger.info("TOTP", "Updated account", { id: account.id });
    res.json({ data: toPublicAccount(account) });
  } catch (error) { next(error); }
};

export const remove: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const deleted = await deleteAccount(id, req.vaultToken);
    if (!deleted) throw new AppError(404, "Account not found");
    logger.info("TOTP", "Removed account", { id });
    res.status(204).send();
  } catch (error) { next(error); }
};

export const code: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    const account = await findAccount(id, req.vaultToken);
    if (!account) throw new AppError(404, "Account not found");
    const snapshot = getTotpWindow(account.secret, account.algorithm, account.digits, account.period);
    const accountWithCode = { ...toPublicAccount(account), ...snapshot };
    logger.info("TOTP", "Generated code", { id: account.id, issuer: account.issuer });
    res.json({ data: accountWithCode });
  } catch (error) { next(error); }
};

export const generate: RequestHandler = (_req, res) => {
  const secret = generateSecret();
  logger.info("TOTP", "Generated secret", { secretLength: secret.length });
  res.status(201).json({ data: { secret } });
};
