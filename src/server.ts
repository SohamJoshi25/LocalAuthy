import "dotenv/config";

import os from "node:os";
import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";


app.listen(env.PORT, env.HOST, () => {
  logger.success("SERVER", "Authy service started", {
    host: env.HOST,
    port: env.PORT,
    environment: env.NODE_ENV,
  });

  const interfaces = os.networkInterfaces();

  if(!env.HOST.startsWith("localhost") && !env.HOST.startsWith("127") )
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses) continue;

    for (const address of addresses) {
      if (address.family === "IPv4" && !address.internal) {
        logger.info("SERVER", `Available at http://${address.address}:${env.PORT}`);    
      }
  }}
});