import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { AppError } from "../utils/errors.js";
import type { Account } from "../types/account.js";

const PBKDF2_ITERATIONS = [5000, 10000, 20000, 50000, 100000, 200000];

function parseJsonIfNeeded(value: string | Record<string, unknown> | undefined): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeBase64(value: string): Buffer {
  return Buffer.from(value, "base64");
}

function listCandidateValues(target: unknown): string[] {
  const values: string[] = [];

  if (typeof target === "string") {
    values.push(target);
  }

  if (isRecord(target)) {
    for (const key of ["servicesEncrypted", "encrypted", "data", "services", "payload", "value"]) {
      const candidate = target[key];
      if (typeof candidate === "string") values.push(candidate);
    }
  }

  return values.filter((value) => value.trim().length > 0);
}

function candidateFragments(value: string): string[] {
  const cleaned = value.trim();
  if (!cleaned.includes(":")) return [cleaned];
  return cleaned.split(":").filter((part) => part.length > 0);
}

function deriveKey(password: string, salt: Buffer, iterations: number): Buffer {
  return pbkdf2Sync(password, salt, iterations, 32, "sha256");
}

function decryptGcm(ciphertext: Buffer, key: Buffer, iv: Buffer, tag: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function collectGcmCombinations(fragments: string[]): Array<{ ciphertext: Buffer; salt: Buffer; iv: Buffer; tag: Buffer }> {
  const combinations: Array<{ ciphertext: Buffer; salt: Buffer; iv: Buffer; tag: Buffer }> = [];

  if (fragments.length >= 4) {
    for (let index = 0; index < fragments.length; index += 1) {
      const salt = decodeBase64(fragments[index]);
      for (let second = 0; second < fragments.length; second += 1) {
        if (second === index) continue;
        const iv = decodeBase64(fragments[second]);
        for (let third = 0; third < fragments.length; third += 1) {
          if (third === index || third === second) continue;
          const tag = decodeBase64(fragments[third]);
          for (let fourth = 0; fourth < fragments.length; fourth += 1) {
            if (fourth === index || fourth === second || fourth === third) continue;
            const ciphertext = decodeBase64(fragments[fourth]);
            combinations.push({ ciphertext, salt, iv, tag });
          }
        }
      }
    }
  }

  if (fragments.length >= 3) {
    for (let combinedIndex = 0; combinedIndex < fragments.length; combinedIndex += 1) {
      const remaining = fragments
        .map((_, index) => index)
        .filter((index) => index !== combinedIndex);

      for (let saltIndex = 0; saltIndex < remaining.length; saltIndex += 1) {
        const saltPosition = remaining[saltIndex];

        for (let ivIndex = 0; ivIndex < remaining.length; ivIndex += 1) {
          if (ivIndex === saltIndex) continue;

          const ivPosition = remaining[ivIndex];
          const combined = decodeBase64(fragments[combinedIndex]);

          if (combined.length <= 16) continue;

          const ciphertext = combined.subarray(0, combined.length - 16);
          const tag = combined.subarray(combined.length - 16);
          const salt = decodeBase64(fragments[saltPosition]);
          const iv = decodeBase64(fragments[ivPosition]);

          combinations.push({ ciphertext, salt, iv, tag });
        }
      }
    }
  }

  return combinations;
}

function decryptByCandidates(rawValue: unknown, password: string): string {
  const candidates = listCandidateValues(rawValue);

  for (const candidate of candidates) {
    const fragments = candidateFragments(candidate);
    if (fragments.length < 2) continue;

    const combinations = collectGcmCombinations(fragments);

    for (const { ciphertext, salt, iv, tag } of combinations) {
      for (const iterations of PBKDF2_ITERATIONS) {
        try {
          const key = deriveKey(password, salt, iterations);
          const plaintext = decryptGcm(ciphertext, key, iv, tag);
          if (plaintext.trim().startsWith("[") || plaintext.trim().startsWith("{")) {
            return plaintext;
          }
        } catch {
          // Try the next combination.
        }
      }
    }
  }

  throw new AppError(400, "Unable to decrypt the 2FAS backup with the supplied password");
}

function firstString(target: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = target[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

function normalizeAlgorithm(value: unknown): Account["algorithm"] {
  const normalized = String(value ?? "sha1").toLowerCase();
  if (normalized.includes("sha512")) return "sha512";
  if (normalized.includes("sha256")) return "sha256";
  return "sha1";
}

function normalizeDigits(value: unknown): 6 | 8 {
  const digits = Number(value ?? 6);
  return digits === 8 ? 8 : 6;
}

function normalizePeriod(value: unknown): number {
  const period = Number(value ?? 30);
  if (!Number.isFinite(period) || period <= 0) return 30;
  return period;
}

function normalizeSecret(value: unknown): string {
  const secret = String(value ?? "").replace(/\s+/g, "").trim();
  if (!secret) throw new AppError(400, "A 2FAS entry is missing its secret");
  return secret;
}

function normalizeService(service: Record<string, unknown>): Omit<Account, "id" | "createdAt" | "updatedAt"> {
  const otp = isRecord(service.otp) ? service.otp : {};
  const flattened = { ...service, ...otp } as Record<string, unknown>;

  const secret = normalizeSecret(
    firstString(flattened, ["secret", "secretKey", "otpSecret", "value"]) ??
      firstString(flattened, ["secret", "secretKey", "value"]),
  );

  const issuer =
    firstString(flattened, ["issuer", "name"]) ??
    "2FAS Import";

  const accountName =
    firstString(flattened, ["accountName", "username", "login", "email", "label", "account"]) ??
    String(issuer);

  return {
    issuer,
    accountName,
    secret,
    algorithm: normalizeAlgorithm(firstString(flattened, ["algorithm", "otpAlgorithm"]) ?? "sha1"),
    digits: normalizeDigits(firstString(flattened, ["digits", "codeLength"]) ?? 6),
    period: normalizePeriod(firstString(flattened, ["period"]) ?? 30),
  };
}

export function normalize2FasServices(raw: unknown, password: string): Omit<Account, "id" | "createdAt" | "updatedAt">[] {
  const parsed = parseJsonIfNeeded(typeof raw === "string" ? raw : JSON.stringify(raw ?? {}));
  const record = isRecord(parsed) ? parsed : {};
  const schemaVersion = Number(record.schemaVersion ?? 0);

  if (!schemaVersion) {
    throw new AppError(400, "The 2FAS export is missing a valid schemaVersion");
  }

  const encryptedValue = record.servicesEncrypted ?? record.encrypted ?? record.data ?? record.payload;

  if (!encryptedValue) {
    const services = Array.isArray(record.services) ? record.services : Array.isArray(record.entries) ? record.entries : [];
    if (!services.length) {
      throw new AppError(400, "No 2FAS services were found to import");
    }

    return services
      .filter(isRecord)
      .map((service) => normalizeService(service));
  }

  const plaintext = decryptByCandidates(encryptedValue, password);
  const decrypted = JSON.parse(plaintext);
  const services = isRecord(decrypted) && Array.isArray(decrypted.services)
    ? decrypted.services
    : Array.isArray(decrypted)
      ? decrypted
      : [];

  if (!services.length) {
    throw new AppError(400, "The decrypted 2FAS backup does not contain any TOTP services");
  }

  return services
    .filter(isRecord)
    .map((service) => normalizeService(service));
}
