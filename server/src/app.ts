import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { isAllowedClientOrigin } from "./lib/clientOrigin.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { v1Router } from "./routes/v1.js";

export { isAllowedClientOrigin } from "./lib/clientOrigin.js";

export const app = express();
app.disable("x-powered-by");
app.disable("etag");
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => callback(
    null,
    isAllowedClientOrigin(origin, config.NODE_ENV, config.CLIENT_ORIGIN)
  ),
  credentials: true
}));
app.use(express.json({ limit: "1500kb" }));
app.use(cookieParser());
app.use(pinoHttp({ logger }));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/v1", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use("/api/v1", v1Router);
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);
