# Authy — Local TOTP Vault

Authy is a small, self-hosted Express-based TOTP (Time-based One-Time Password) authenticator and vault. It stores TOTP accounts in a locally encrypted vault file and exposes a simple JSON API for creating the vault, unlocking it for a short-lived session, managing TOTP entries, and importing 2FAS exports.

This repository uses TypeScript and provides development and production build scripts.

---

## Features

- Create a locally encrypted vault protected by a master password
- Unlock the vault to get a short-lived session token for protected routes
- Add, update, list, delete TOTP accounts (secrets are stored encrypted on disk)
- Generate new base32 secrets for TOTP
- Import 2FAS backup exports (decrypt and normalize entries into the vault)
- Simple HTML UI for local usage (served from the `views`/`public` directories)

Relevant files:
- Server entry: [src/server.ts](/home/sohamjoshi/Development/Express/Authy/src/server.ts)
- Express app: [src/app.ts](/home/sohamjoshi/Development/Express/Authy/src/app.ts)
- API routes: [src/routes/api.ts](/home/sohamjoshi/Development/Express/Authy/src/routes/api.ts)
- Vault and account logic: [src/services/vault.ts](/home/sohamjoshi/Development/Express/Authy/src/services/vault.ts)
- Tests: [tests/app.test.ts](/home/sohamjoshi/Development/Express/Authy/tests/app.test.ts)

---

## Requirements

- Node.js 18+ (tested with modern Node versions)
- npm

Note: The project uses ES modules ("type": "module").

---

## Installation

1. Clone the repository and change directory:

   git clone <repo-url> authy
   cd authy

2. Install dependencies:

   npm install

3. Copy environment variables (optional). You can create a `.env` in the project root to override defaults:

   PORT (default: 3000)
   HOST (default: localhost)
   VAULT_FILE (default: src/data/vault.json)
   NODE_ENV (development | test | production)

Example .env:

   PORT=3000
   HOST=localhost
   VAULT_FILE=src/data/vault.json

---

## Development

Start the dev server (hot reload via tsx):

  npm run dev

Run the full test suite (includes TypeScript typecheck):

  npm test

Build for production:

  npm run build

Start production server (verifies tests and build first):

  npm start

Run the server and bind to all interfaces (useful for testing on LAN):

  npm run network

---

## Environment

The application reads configuration from environment variables (see [src/config/env.ts](/home/sohamjoshi/Development/Express/Authy/src/config/env.ts)). Defaults are:

- NODE_ENV: development
- HOST: localhost
- PORT: 3000
- VAULT_FILE: src/data/vault.json

---

## API Overview

Base URL: /api

A machine-readable API reference is available at `/api/docs` and `/api/routes` (redirects to docs).

Main endpoints (examples):

- GET /api/health
  - Returns: { status: "ok" }

- POST /api/vault
  - Create a new encrypted vault
  - Body: { "password": "<master-password>" }
  - Example: curl -X POST http://localhost:3000/api/vault -H 'Content-Type: application/json' -d '{"password":"StrongPassword!123"}'

- POST /api/vault/unlock
  - Unlock vault and receive a token for protected routes
  - Body: { "password": "<master-password>" }
  - Response: { data: { token: "<session-token>" } }

- POST /api/vault/import-2fas
  - Import a 2FAS backup (file upload or JSON payload)
  - Requires either Authorization: Bearer <token> (if vault unlocked) or provide vaultPassword in body to create/unlock vault for import
  - Example (JSON payload):
    curl -X POST http://localhost:3000/api/vault/import-2fas -H 'Content-Type: application/json' -d '{"backupPassword":"backup-secret","vaultPassword":"app-master-password","source":{...}}'

- POST /api/vault/lock
  - Lock vault (invalidate session token)
  - Header: Authorization: Bearer <token>

- GET /api/vault/status
  - Check if vault is unlocked for the session
  - Header: Authorization: Bearer <token>

- GET /api/totp
  - List TOTP accounts with current and next codes
  - Header: Authorization: Bearer <token>

- POST /api/totp
  - Add a new TOTP entry
  - Body example: { "issuer":"GitHub","accountName":"demo@example.com","secret":"GEZDGNBVGY3TQOJQ...","algorithm":"sha1","digits":6,"period":30 }

For a full, up-to-date endpoint catalog see [src/routes/api.ts](/home/sohamjoshi/Development/Express/Authy/src/routes/api.ts).

---

## Security & Storage

- Vault file (default: `src/data/vault.json`) is encrypted with a key derived from the master password using a KDF.
- Secrets are never stored in plaintext on disk.
- Unlocking the vault derives the key and keeps it only in memory for the server session; sessions use random tokens.
- The server writes the vault file with restrictive permissions (0600) and uses atomic replace to avoid corruption.

Security notes:
- Keep the vault file and your master password secure and backed up.
- This project is intended as a local/self-hosted authenticator — exposing it publicly requires additional hardening (HTTPS, reverse proxy, access controls, monitoring).

---

## Importing 2FAS Backups

Authy supports importing exported 2FAS backups. The import endpoint accepts either a file upload (multipart/form-data) or JSON payload containing the 2FAS backup. A backup password is required to decrypt the 2FAS export. See the import logic in [src/controllers/vault.ts](/home/sohamjoshi/Development/Express/Authy/src/controllers/vault.ts).

---

## Tests

Tests are written with Vitest and include a typecheck step. Run them with:

  npm test

Tests and mocks are located in [tests/](/home/sohamjoshi/Development/Express/Authy/tests).

---

## Contributing

Contributions are welcome. Please open issues or PRs for bug reports, enhancements, or documentation fixes. Run tests locally and ensure TypeScript typechecks pass before submitting a PR.

Style / commit note: Commits created by automated tools in this repository include a Copilot co-author trailer.

---

## License

MIT — see the LICENSE file.

---

If anything in this README should be adjusted (installation steps, example commands, more API examples, or adding screenshots), provide details and an update can be made.