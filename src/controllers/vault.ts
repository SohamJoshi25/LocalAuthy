import type { RequestHandler } from "express";
import { z } from "zod";
import { normalize2FasServices } from "../services/twofas-import.js";
import { createAccount, createVault, getVaultStatus, isUnlocked, lockVault, unlockVault, vaultExists } from "../services/vault.js";
import { AppError } from "../utils/errors.js";

const passwordSchema = z.object({ password: z.string().min(1).max(512) });
const importSchema = z.object({
  backupPassword: z.string().min(1).max(512).optional(),
  vaultPassword: z.string().min(1).max(512).optional(),
  source: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  payload: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  fileContent: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
});

function resolveImportSource(req: Parameters<RequestHandler>[0]): unknown {
  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const directSource = body.source ?? body.payload ?? body.fileContent;

  if (directSource) return directSource;

  if (req.file && Buffer.isBuffer(req.file.buffer)) {
    const raw = req.file.buffer.toString("utf8");
    if (raw.trim().length > 0) {
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    }
  }

  return undefined;
}

function resolveBackupPassword(req: Parameters<RequestHandler>[0]): string | undefined {
  const body = (req.body && typeof req.body === "object") ? req.body : {};
  const value = typeof body.backupPassword === "string" ? body.backupPassword : undefined;
  return value && value.trim().length > 0 ? value : undefined;
}

function resolveVaultToken(req: Parameters<RequestHandler>[0]): string | undefined {
  const header = req.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) return req.vaultToken;
  if (!isUnlocked(token)) {
    throw new AppError(401, "Vault is locked or the session is invalid");
  }

  req.vaultToken = token;
  return token;
}

export const create: RequestHandler = async (req, res, next) => { try { await createVault(passwordSchema.parse(req.body).password); res.status(201).json({ data: { status: "created" } }); } catch (error) { next(error); } };
export const unlock: RequestHandler = async (req, res, next) => { try { const token = await unlockVault(passwordSchema.parse(req.body).password); res.json({ data: { status: "unlocked", token } }); } catch (error) { next(error); } };
export const lock: RequestHandler = (req, res) => { lockVault(req.vaultToken); res.json({ data: { status: "locked" } }); };
export const status: RequestHandler = async (_req, res, next) => {
  try {
    const status = await getVaultStatus(_req.vaultToken);
    res.json({ data: { unlocked: status.unlocked, modifiedAt: status.modifiedAt } });
  } catch (error) {
    next(error);
  }
};

export const importTwoFas: RequestHandler = async (req, res, next) => {
  try {
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const payload = importSchema.parse({ ...body, backupPassword: resolveBackupPassword(req), vaultPassword: typeof body.vaultPassword === "string" ? body.vaultPassword : undefined });
    const source = resolveImportSource(req);
    const backupPassword = payload.backupPassword;

    if (!source) throw new AppError(400, "A 2FAS export payload is required");
    if (!backupPassword) throw new AppError(400, "A 2FAS backup password is required");

    const hasVault = await vaultExists();
    let token: string | undefined = resolveVaultToken(req);

    if (!token) {
      if (hasVault) {
        if (!payload.vaultPassword) throw new AppError(401, "A vault password is required to unlock an existing vault");
        token = await unlockVault(payload.vaultPassword);
      } else {
        if (!payload.vaultPassword) throw new AppError(401, "A vault password is required to create a vault for import");
        await createVault(payload.vaultPassword);
        token = await unlockVault(payload.vaultPassword);
      }
    }

    try {
      const entries = normalize2FasServices(source, backupPassword);
      const imported = [] as Array<{ id: string; issuer: string; accountName: string }>;

      for (const entry of entries) {
        try {
          const created = await createAccount(entry, token);

          imported.push({
            id: created.id,
            issuer: created.issuer,
            accountName: created.accountName,
          });

        } catch (err) {
          if (err instanceof AppError && err.statusCode === 409) {
            continue;
          }
          throw err;
        }
      }
      res.status(201).json({ data: { imported: imported.length, entries: imported } });
    } finally {
      if (!req.vaultToken) {
        lockVault(token);
      }
    }
  } catch (error) {
    next(error);
  }
};
