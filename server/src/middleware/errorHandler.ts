import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../lib/logger.js";

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({ error: "Invalid request", details: error.issues.map(({ path, message }) => ({ path, message })) });
    return;
  }
  const statusCode = typeof error.statusCode === "number"
    ? error.statusCode
    : error.name === "DocumentNotFoundError"
      ? 404
      : error.name === "ValidationError"
        ? 400
        : error.code === 11000
          ? 409
          : 500;
  if (statusCode >= 500) logger.error({ err: error }, "Request failed");
  res.status(statusCode).json({
    error: statusCode >= 500
      ? "Internal server error"
      : statusCode === 404
        ? "Resource not found"
        : statusCode === 409
          ? "Resource already exists"
          : error.message,
    ...(process.env.NODE_ENV === "development" && statusCode >= 500 ? { detail: error.message } : {})
  });
};
