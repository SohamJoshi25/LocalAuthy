import { env } from "../config/env.js";

type LogLevel = "INFO" | "WARN" | "ERROR" | "SUCCESS";

const colors = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  magenta: "\u001b[35m",
  blue: "\u001b[34m",
};

const levelColors: Record<LogLevel, string> = {
  INFO: colors.cyan,
  WARN: colors.yellow,
  ERROR: colors.red,
  SUCCESS: colors.green,
};

function formatMessage(level: LogLevel, scope: string, message: string, meta?: unknown): string {
  const timestamp = new Date().toISOString();
  const scopeLabel = `[${scope}]`;
  const prefix = `${colors.dim}${timestamp}${colors.reset} ${levelColors[level]}${level.padEnd(7, " ")}${colors.reset} ${colors.magenta}${scopeLabel.padEnd(5, " ")}${colors.reset} ${message}`;

  if (meta === undefined) return prefix;

  const serialized = typeof meta === "string" ? meta : JSON.stringify(meta);
  return `${prefix} ${colors.blue}${serialized}${colors.reset}`;
}

function log(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  if(env.LOG_LEVEL.split(",").length != 0){
    if(!env.LOG_LEVEL.split(",").map(l => l.toUpperCase().includes(level))){
      return;
    }
  }
  
  const output = formatMessage(level, scope, message, meta);
  if (level === "ERROR") {
    console.error(output);
    return;
  }
  console.log(output);
}

export const logger = {
  info: (scope: string, message: string, meta?: unknown) => log("INFO", scope, message, meta),
  warn: (scope: string, message: string, meta?: unknown) => log("WARN", scope, message, meta),
  error: (scope: string, message: string, meta?: unknown) => log("ERROR", scope, message, meta),
  success: (scope: string, message: string, meta?: unknown) => log("SUCCESS", scope, message, meta),
};
