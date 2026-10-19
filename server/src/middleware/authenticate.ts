import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    next(Object.assign(new Error("Authentication required"), { statusCode: 401 }));
    return;
  }

  try {
    const payload = jwt.verify(token, config.JWT_ACCESS_SECRET);
    if (typeof payload === "string" || typeof payload.sub !== "string") throw new Error("Invalid token");
    req.userId = payload.sub;
    next();
  } catch {
    next(Object.assign(new Error("Invalid or expired access token"), { statusCode: 401 }));
  }
}
