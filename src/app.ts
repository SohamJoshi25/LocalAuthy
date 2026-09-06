import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { apiRouter } from "./routes/api.js";
import { homePage } from "./ui.js";
import { errorHandler, notFoundHandler } from "./utils/errors.js";
import { logger } from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = existsSync(path.join(__dirname, "views")) ? __dirname : path.resolve(__dirname, "../src");
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(appRoot, "views"));

app.use((req, _res, next) => {
  logger.info("HTTP", "Request received", { method: req.method, path: req.path });
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        upgradeInsecureRequests: null,
        imgSrc: ["'self'","data:", "https://img.logo.dev"],
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(appRoot, "public")));
app.use("/assets", express.static(path.join(appRoot, "public")));

app.get("/", homePage);
app.get("/ui", homePage);

app.use("/api", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
