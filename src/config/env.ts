import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  VAULT_PATH: z.string().default("src/data/vault.json"),
  VAULT_FILE: z.string().default("src/data/vault.json"),
});

const resolvedEnv = {
  ...process.env,
  VAULT_PATH: process.env.VAULT_PATH ?? process.env.VAULT_FILE ?? "src/data/vault.json",
  VAULT_FILE: process.env.VAULT_PATH ?? process.env.VAULT_FILE ?? "src/data/vault.json",
};

export const env = envSchema.parse(resolvedEnv);
