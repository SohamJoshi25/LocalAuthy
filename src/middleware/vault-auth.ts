import type { RequestHandler } from "express";
import { isUnlocked } from "../services/vault.js";
import { AppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

export const vaultAuth: RequestHandler = (req, _res, next) => {
  const header = req.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token || !isUnlocked(token)) {
    logger.warn("AUTH", "Rejected request with invalid vault session", { path: req.path, method: req.method });
    next(new AppError(401, "Vault is locked or the session is invalid"));
    return;
  }

  logger.info("AUTH", "Validated vault session", { path: req.path, method: req.method });
  resToken(req, token);
  next();
};

function resToken(req: Parameters<RequestHandler>[0], token: string): void { req.vaultToken = token; }

declare global { namespace Express { interface Request { vaultToken?: string } } }
