import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "./logger.js";

export class AppError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "AppError";
  }
}

export const notFoundHandler: RequestHandler = (req, res) => {
  logger.warn("HTTP", "Route not found", { method: req.method, path: req.path });
  res.status(404).json({ error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.path} not found` } });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) {
    logger.warn("VALIDATION", "Request validation failed", { method: req.method, path: req.path, issues: error.issues });
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request validation failed", details: error.issues } });
    return;
  }

  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const message = error instanceof AppError ? error.message : "Internal server error";
  if (statusCode === 500) {
    logger.error("APP", "Unhandled server error", { method: req.method, path: req.path, error: error instanceof Error ? error.message : String(error) });
  } else {
    logger.warn("APP", "Request error", { method: req.method, path: req.path, statusCode, message });
  }

  res.status(statusCode).json({ error: { code: statusCode === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR", message } });
};
