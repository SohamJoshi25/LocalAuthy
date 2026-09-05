import { Router } from "express";
import multer from "multer";
import * as accounts from "../controllers/accounts.js";
import * as vault from "../controllers/vault.js";
import { vaultAuth } from "../middleware/vault-auth.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const endpointCatalog = [
  {
    method: "GET",
    path: "/api/health",
    auth: "none",
    description: "Returns the API health status.",
    usage: "curl http://localhost:3000/api/health",
  },
  {
    method: "POST",
    path: "/api/vault",
    auth: "none",
    description: "Creates the encrypted vault with the provided master password.",
    usage: "curl -X POST http://localhost:3000/api/vault -H 'Content-Type: application/json' -d '{\"password\":\"StrongPassword!123\"}'",
  },
  {
    method: "POST",
    path: "/api/vault/unlock",
    auth: "none",
    description: "Unlocks the vault and returns a session token valid for protected routes.",
    usage: "curl -X POST http://localhost:3000/api/vault/unlock -H 'Content-Type: application/json' -d '{\"password\":\"StrongPassword!123\"}'",
  },
  {
    method: "POST",
    path: "/api/vault/import-2fas",
    auth: "Bearer token or vaultPassword",
    description: "Imports a 2FAS backup file, decrypts the TOTP entries, and stores them in the local encrypted vault.",
    usage: "curl -X POST http://localhost:3000/api/vault/import-2fas -H 'Content-Type: application/json' -d '{\"backupPassword\":\"backup-secret\",\"vaultPassword\":\"app-master-password\",\"source\":{\"schemaVersion\":4,\"servicesEncrypted\":\"...\"}}'",
  },
  {
    method: "POST",
    path: "/api/vault/lock",
    auth: "Bearer token",
    description: "Invalidates the current vault session and removes the in-memory key.",
    usage: "curl -X POST http://localhost:3000/api/vault/lock -H 'Authorization: Bearer <token>'",
  },
  {
    method: "GET",
    path: "/api/vault/status",
    auth: "Bearer token",
    description: "Checks whether the vault is currently unlocked for the session.",
    usage: "curl http://localhost:3000/api/vault/status -H 'Authorization: Bearer <token>'",
  },
  {
    method: "GET",
    path: "/api/totp",
    auth: "Bearer token",
    description: "Lists TOTP accounts and includes the current code plus the next code for each account without exposing plaintext secrets.",
    usage: "curl http://localhost:3000/api/totp -H 'Authorization: Bearer <token>'",
  },
  {
    method: "POST",
    path: "/api/totp",
    auth: "Bearer token",
    description: "Adds a new TOTP entry to the encrypted vault.",
    usage: "curl -X POST http://localhost:3000/api/totp -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' -d '{\"issuer\":\"GitHub\",\"accountName\":\"demo@example.com\",\"secret\":\"GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ\",\"algorithm\":\"sha1\",\"digits\":6,\"period\":30}'",
  },
  {
    method: "POST",
    path: "/api/totp/generate-secret",
    auth: "Bearer token",
    description: "Generates a new base32 secret for a TOTP entry.",
    usage: "curl -X POST http://localhost:3000/api/totp/generate-secret -H 'Authorization: Bearer <token>'",
  },
  {
    method: "GET",
    path: "/api/totp/:id/code",
    auth: "Bearer token",
    description: "Generates the current TOTP code and the next code for a specific account ID.",
    usage: "curl http://localhost:3000/api/totp/<id>/code -H 'Authorization: Bearer <token>'",
  },
  {
    method: "PUT",
    path: "/api/totp/:id",
    auth: "Bearer token",
    description: "Updates an existing TOTP entry.",
    usage: "curl -X PUT http://localhost:3000/api/totp/<id> -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' -d '{\"issuer\":\"GitHub\"}'",
  },
  {
    method: "DELETE",
    path: "/api/totp/:id",
    auth: "Bearer token",
    description: "Deletes a TOTP entry from the vault.",
    usage: "curl -X DELETE http://localhost:3000/api/totp/<id> -H 'Authorization: Bearer <token>'",
  },
];

export const apiRouter = Router();

apiRouter.get("/health", (_req, res) => res.json({ status: "ok" }));
apiRouter.get("/docs", (_req, res) => {
  res.json({
    data: {
      title: "Authy API reference",
      version: "v1",
      baseUrl: "/api",
      endpoints: endpointCatalog,
    },
  });
});
apiRouter.get("/routes", (_req, res) => res.redirect("/api/docs"));

apiRouter.post("/vault", vault.create);
apiRouter.post("/vault/unlock", vault.unlock);
apiRouter.post("/vault/import-2fas", upload.single("file"), vault.importTwoFas);
apiRouter.post("/vault/lock", vaultAuth, vault.lock);
apiRouter.get("/vault/status", vaultAuth, vault.status);

apiRouter.get("/totp", vaultAuth, accounts.list);
apiRouter.post("/totp", vaultAuth, accounts.create);
apiRouter.post("/totp/generate-secret", vaultAuth, accounts.generate);
apiRouter.get("/totp/:id/code", vaultAuth, accounts.code);
apiRouter.put("/totp/:id", vaultAuth, accounts.update);
apiRouter.delete("/totp/:id", vaultAuth, accounts.remove);

