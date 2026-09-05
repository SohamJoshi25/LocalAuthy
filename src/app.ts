import express from "express";
import cors from "cors";
import helmet from "helmet";
import { apiRouter } from "./routes/api.js";
import { errorHandler, notFoundHandler } from "./utils/errors.js";
import { logger } from "./utils/logger.js";

const app = express();

app.use((req, _res, next) => {
  logger.info("HTTP", "Request received", { method: req.method, path: req.path });
  next();
});

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  logger.info("HTTP", "Health root requested", { method: req.method, path: req.path });
  res.json({ name: "Authy API", status: "ok" });
});

app.use("/api", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;