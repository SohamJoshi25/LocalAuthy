import "dotenv/config";
import { z } from "zod";
import os from "node:os";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("localhost"),
  PORT: z.coerce.number().int().positive().default(8888),
  VAULT_FILE: z.string().default(() => `${os.homedir()}/.auth_vault.json`),
  LOGO_DEV_PUBLISHABLE_KEY: z.string().default(""),
  CERT_PATH: z.string().default("/etc/ssl/certs/cert.pem"),
  KEY_PATH: z.string().default("/etc/ssl/certs/key.pem"),
  LOG_LEVEL: z.string().default("")
});

export const env = envSchema.parse(process.env);
