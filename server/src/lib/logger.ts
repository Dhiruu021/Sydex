import pino from "pino";
import { config } from "../config.js";

export const logger = pino({
  level: config.NODE_ENV === "development" ? "debug" : "info",
  redact: ["req.headers.authorization", "req.headers.cookie", "res.headers.set-cookie"]
});
