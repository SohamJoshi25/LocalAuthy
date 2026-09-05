import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

describe("Authy vault flow", () => {
  const vaultDir = mkdtempSync(
    path.join(tmpdir(), "authy-test-"),
  );

  const vaultPath = path.join(
    vaultDir,
    "vault.json",
  );

  const vaultPassword = "StrongPassword!123";
  const backupPassword = "2fas-backup-pass";

  const secret =
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";


  beforeEach(() => {
    vi.resetModules();

    process.env.VAULT_PATH = vaultPath;
    process.env.VAULT_FILE = vaultPath;

    if (existsSync(vaultPath)) {
      rmSync(vaultPath, {
        force: true,
      });
    }
  });


  afterEach(() => {
    if (existsSync(vaultPath)) {
      rmSync(vaultPath, {
        force: true,
      });
    }
  });


  async function createVault(app: any) {
    const response = await request(app)
      .post("/api/vault")
      .send({
        password: vaultPassword,
      });

    expect(response.status).toBe(201);

    return response;
  }


  async function unlockVault(app: any) {
    const response = await request(app)
      .post("/api/vault/unlock")
      .send({
        password: vaultPassword,
      });

    expect(response.status).toBe(200);

    return response;
  }


  function createEncrypted2FasExport(
    options?: {
      combinedTag?: boolean;
      accountName?: string;
      issuer?: string;
    },
  ) {
    const accountName =
      options?.accountName ??
      "demo@example.com";

    const issuer =
      options?.issuer ??
      "GitHub";

    const plaintext = JSON.stringify({
      services: [
        {
          issuer,
          accountName,
          secret,
          algorithm: "sha1",
          digits: 6,
          period: 30,
        },
      ],
    });


    const salt = randomBytes(16);
    const iv = randomBytes(12);

    const key = pbkdf2Sync(
      backupPassword,
      salt,
      5000,
      32,
      "sha256",
    );

    const cipher = createCipheriv(
      "aes-256-gcm",
      key,
      iv,
    );

    const ciphertext = Buffer.concat([
      cipher.update(
        Buffer.from(plaintext, "utf8"),
      ),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    const encryptedPayload =
      options?.combinedTag
        ? Buffer.concat([
            ciphertext,
            tag,
          ])
        : null;


    const parts = options?.combinedTag
      ? [
          salt.toString("base64"),
          iv.toString("base64"),
          encryptedPayload!.toString("base64"),
        ]
      : [
          salt.toString("base64"),
          iv.toString("base64"),
          tag.toString("base64"),
          ciphertext.toString("base64"),
        ];


    return Buffer.from(
      JSON.stringify({
        schemaVersion: 4,
        servicesEncrypted: parts.join(":"),
      }),
    );
  }


  it(
    "creates a vault, unlocks it, stores TOTP secrets encrypted, and rejects invalid sessions",
    async () => {
      const { default: app } =
        await import("../src/app.js");


      const created = await request(app)
        .post("/api/vault")
        .send({
          password: vaultPassword,
        });

      expect(created.status).toBe(201);
      expect(created.body.data.status).toBe(
        "created",
      );


      const unlock = await request(app)
        .post("/api/vault/unlock")
        .send({
          password: vaultPassword,
        });

      expect(unlock.status).toBe(200);
      expect(unlock.body.data.status).toBe(
        "unlocked",
      );


      const token =
        unlock.body.data.token;

      expect(token).toMatch(
        /^[a-f0-9]{64}$/,
      );


      const blank = await request(app)
        .get("/api/totp")
        .set(
          "Authorization",
          `Bearer ${token}`,
        );

      expect(blank.status).toBe(200);
      expect(blank.body.data).toEqual([]);


      const statusBeforeWrite =
        await request(app)
          .get("/api/vault/status")
          .set(
            "Authorization",
            `Bearer ${token}`,
          );

      expect(statusBeforeWrite.status).toBe(
        200,
      );

      expect(
        statusBeforeWrite.body.data.unlocked,
      ).toBe(true);

      expect(
        statusBeforeWrite.body.data.modifiedAt,
      ).toMatch(
        /^\d{4}-\d{2}-\d{2}T/,
      );


      const createdEntry =
        await request(app)
          .post("/api/totp")
          .set(
            "Authorization",
            `Bearer ${token}`,
          )
          .send({
            issuer: "GitHub",
            accountName: "demo@example.com",
            secret,
            algorithm: "sha1",
            digits: 6,
            period: 30,
          });


      expect(createdEntry.status).toBe(201);

      expect(
        createdEntry.body.data.secret,
      ).toBeUndefined();

      expect(
        createdEntry.body.data.accountName,
      ).toBe("demo@example.com");


      const codeResponse =
        await request(app)
          .get(
            `/api/totp/${createdEntry.body.data.id}/code`,
          )
          .set(
            "Authorization",
            `Bearer ${token}`,
          );


      expect(codeResponse.status).toBe(200);

      expect(
        codeResponse.body.data.code,
      ).toMatch(/^\d{6}$/);

      expect(
        codeResponse.body.data.nextCode,
      ).toMatch(/^\d{6}$/);

      expect(
        codeResponse.body.data.expiresAt,
      ).toBeTypeOf("number");

      expect(
        codeResponse.body.data.remainingSeconds,
      ).toBeGreaterThanOrEqual(0);


      const locked = await request(app)
        .post("/api/vault/lock")
        .set(
          "Authorization",
          `Bearer ${token}`,
        );


      expect(locked.status).toBe(200);

      expect(
        locked.body.data.status,
      ).toBe("locked");


      const afterLock =
        await request(app)
          .get("/api/totp")
          .set(
            "Authorization",
            `Bearer ${token}`,
          );

      expect(afterLock.status).toBe(401);
    },
  );


  it(
    "serves the canonical API catalog without legacy aliases",
    async () => {
      const { default: app } =
        await import("../src/app.js");


      const docs = await request(app)
        .get("/api/docs");


      expect(docs.status).toBe(200);

      expect(
        docs.body.data.title,
      ).toBe("Authy API reference");

      expect(
        Array.isArray(
          docs.body.data.endpoints,
        ),
      ).toBe(true);


      expect(
        docs.body.data.endpoints.some(
          (endpoint: { path: string }) =>
            endpoint.path ===
            "/api/vault/unlock",
        ),
      ).toBe(true);


      expect(
        docs.body.data.endpoints.some(
          (endpoint: { path: string }) =>
            endpoint.path ===
            "/api/totp/:id/code",
        ),
      ).toBe(true);


      expect(
        docs.body.data.endpoints.some(
          (endpoint: { path: string }) =>
            endpoint.path ===
            "/api/accounts",
        ),
      ).toBe(false);
    },
  );


  it(
    "requires a valid vault session for TOTP code generation",
    async () => {
      const { default: app } =
        await import("../src/app.js");


      const response = await request(app)
        .get("/api/totp/abc/code");


      expect(response.status).toBe(401);

      expect(
        response.body.error.message,
      ).toBe(
        "Vault is locked or the session is invalid",
      );
    },
  );


  it(
    "imports a 2FAS export into an unlocked vault",
    async () => {
      const { default: app } =
        await import("../src/app.js");


      await createVault(app);

      const unlock =
        await unlockVault(app);


      const response = await request(app)
        .post("/api/vault/import-2fas")
        .set(
          "Authorization",
          `Bearer ${unlock.body.data.token}`,
        )
        .field(
          "backupPassword",
          backupPassword,
        )
        .attach(
          "file",
          createEncrypted2FasExport(),
          {
            filename: "backup.2fas",
            contentType:
              "application/json",
          },
        );


      expect(response.status).toBe(201);

      expect(
        response.body.data.imported,
      ).toBe(1);

      expect(
        response.body.data.entries[0]
          .accountName,
      ).toBe("demo@example.com");
    },
  );


  it(
    "imports a 2FAS export using the vault password",
    async () => {
      const { default: app } =
        await import("../src/app.js");


      await createVault(app);


      const response = await request(app)
        .post("/api/vault/import-2fas")
        .field(
          "backupPassword",
          backupPassword,
        )
        .field(
          "vaultPassword",
          vaultPassword,
        )
        .attach(
          "file",
          createEncrypted2FasExport(),
          {
            filename: "backup.2fas",
            contentType:
              "application/json",
          },
        );


      expect(response.status).toBe(201);

      expect(
        response.body.data.imported,
      ).toBe(1);

      expect(
        response.body.data.entries[0]
          .accountName,
      ).toBe("demo@example.com");


      const unlock =
        await unlockVault(app);


      const list = await request(app)
        .get("/api/totp")
        .set(
          "Authorization",
          `Bearer ${unlock.body.data.token}`,
        );


      expect(list.status).toBe(200);

      expect(list.body.data).toHaveLength(1);

      expect(
        list.body.data[0].accountName,
      ).toBe("demo@example.com");

      expect(
        list.body.data[0].secret,
      ).toBeUndefined();

      expect(
        list.body.data[0].code,
      ).toMatch(/^\d{6}$/);
    },
  );


  it(
  "skips duplicate accounts during 2FAS import",
  async () => {
    const { default: app } =
      await import("../src/app.js");

    await createVault(app);

    const unlock =
      await unlockVault(app);

    const token =
      unlock.body.data.token;

    const firstImport =
      await request(app)
        .post("/api/vault/import-2fas")
        .set(
          "Authorization",
          `Bearer ${token}`,
        )
        .field(
          "backupPassword",
          backupPassword,
        )
        .attach(
          "file",
          createEncrypted2FasExport(),
          {
            filename: "backup.2fas",
            contentType: "application/json",
          },
        );

    expect(firstImport.status).toBe(201);
    expect(firstImport.body.data.imported).toBe(1);

    const duplicateImport =
      await request(app)
        .post("/api/vault/import-2fas")
        .set(
          "Authorization",
          `Bearer ${token}`,
        )
        .field(
          "backupPassword",
          backupPassword,
        )
        .attach(
          "file",
          createEncrypted2FasExport(),
          {
            filename: "backup.2fas",
            contentType: "application/json",
          },
        );

    expect(duplicateImport.status).toBe(201);

    expect(
      duplicateImport.body.data.imported,
    ).toBe(0);
  },
);


  it(
    "decrypts 2FAS exports where ciphertext and tag are combined in one field",
    async () => {
      const { default: app } =
        await import("../src/app.js");


      await createVault(app);

      const unlocked =
        await unlockVault(app);


      const response = await request(app)
        .post("/api/vault/import-2fas")
        .set(
          "Authorization",
          `Bearer ${unlocked.body.data.token}`,
        )
        .field(
          "backupPassword",
          backupPassword,
        )
        .field(
          "source",
          createEncrypted2FasExport({
            combinedTag: true,
          }).toString("utf8"),
        );


      expect(response.status).toBe(201);

      expect(
        response.body.data.imported,
      ).toBe(1);

      expect(
        response.body.data.entries[0]
          .accountName,
      ).toBe("demo@example.com");
    },
  );


  it(
    "normalizes the real 2FAS decrypted service shape with name and otp.label",
    async () => {
      const decrypted = {
        services: [
          {
            name: "Discord",

            secret,

            otp: {
              label:
                "sohamjoshichinchwad@gmail.com",

              account:
                "sohamjoshichinchwad@gmail.com",

              issuer: "Discord",

              digits: 6,

              period: 30,

              algorithm: "SHA1",

              tokenType: "TOTP",
            },
          },
        ],

        schemaVersion: 4,
      };


      const {
        normalize2FasServices,
      } = await import(
        "../src/services/twofas-import.js"
      );


      const normalized =
        normalize2FasServices(
          decrypted,
          "unused-password",
        );


      expect(normalized).toHaveLength(1);

      expect(
        normalized[0].issuer,
      ).toBe("Discord");

      expect(
        normalized[0].accountName,
      ).toBe(
        "sohamjoshichinchwad@gmail.com",
      );

      expect(
        normalized[0].secret,
      ).toBe(secret);
    },
  );


  it(
    "generates TOTP codes for short but valid secrets",
    async () => {
      const { default: app } =
        await import("../src/app.js");


      await createVault(app);

      const unlocked =
        await unlockVault(app);


      const created = await request(app)
        .post("/api/totp")
        .set(
          "Authorization",
          `Bearer ${unlocked.body.data.token}`,
        )
        .send({
          issuer: "Short Secret",
          accountName:
            "demo@example.com",

          secret:
            "JBSWY3DPEHPK3PXP",

          algorithm: "sha1",
          digits: 6,
          period: 30,
        });


      expect(created.status).toBe(201);


      const code = await request(app)
        .get(
          `/api/totp/${created.body.data.id}/code`,
        )
        .set(
          "Authorization",
          `Bearer ${unlocked.body.data.token}`,
        );


      expect(code.status).toBe(200);

      expect(
        code.body.data.code,
      ).toMatch(/^\d{6}$/);
    },
  );


  it(
    "allows creating a vault when the file exists but is empty",
    async () => {
      writeFileSync(
        vaultPath,
        "",
        "utf8",
      );


      const { default: app } =
        await import("../src/app.js");


      const response = await request(app)
        .post("/api/vault")
        .send({
          password: vaultPassword,
        });


      expect(response.status).toBe(201);

      expect(
        response.body.data.status,
      ).toBe("created");
    },
  );


  it(
    "fails when the vault password is wrong and rejects tampered ciphertext",
    async () => {
      const { default: app } =
        await import("../src/app.js");


      await createVault(app);


      const badPassword =
        await request(app)
          .post("/api/vault/unlock")
          .send({
            password: "WrongPassword!123",
          });


      expect(
        badPassword.status,
      ).toBe(401);


      const rawVault = JSON.parse(
        readFileSync(
          vaultPath,
          "utf8",
        ),
      );


      rawVault.data =
        Buffer.from(
          "tampered-data",
          "utf8",
        ).toString("base64");


      writeFileSync(
        vaultPath,
        JSON.stringify(
          rawVault,
          null,
          2,
        ),
      );


      const tampered =
        await request(app)
          .post("/api/vault/unlock")
          .send({
            password: vaultPassword,
          });


      expect(
        tampered.status,
      ).toBe(401);
    },
  );
});