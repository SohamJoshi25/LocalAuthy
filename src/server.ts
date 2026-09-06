import "dotenv/config";

import os from "node:os";
import https from "node:https";
import fs from "node:fs";
import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

const key = fs.readFileSync(env.KEY_PATH);
const cert = fs.readFileSync(env.CERT_PATH);

const server = https.createServer({key, cert},app);

server.listen(env.PORT, env.HOST, () => {
  logger.success("SERVER", "Authy service started", {
    host: env.HOST,
    port: env.PORT,
    environment: env.NODE_ENV,
  });

  const interfaces = os.networkInterfaces();

  if (
    !env.HOST.startsWith("localhost") &&
    !env.HOST.startsWith("127")
  ) {
    for (const [_name, addresses] of Object.entries(interfaces)) {
      if (!addresses) continue;

      for (const address of addresses) {
        if (address.family === "IPv4" && !address.internal) {
          logger.info(
            "SERVER",
            `Available at https://${address.address}:${env.PORT}`,
          );
        }
      }
    }
  }
});