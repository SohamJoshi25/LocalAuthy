import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("localhost"),
  PORT: z.coerce.number().int().positive().default(3000),
  VAULT_FILE: z.string().default("src/data/vault.json"),
  LOGO_DEV_PUBLISHABLE_KEY: z.string().default("")
});

const resolvedEnv = {
  ...process.env,
  HOST: process.env.HOST ?? "localhost",
  VAULT_FILE: process.env.VAULT_FILE ?? "src/data/vault.json",
};

export const env = envSchema.parse(resolvedEnv);
