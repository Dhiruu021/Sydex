import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
  EMAIL_OTP_PROVIDER: z.enum(["mock", "resend"]).default("mock"),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().min(3).default("onboarding@resend.dev"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  COOKIE_SAME_SITE: z.enum(["lax", "none"]).default("lax")
});

export const config = schema.parse(process.env);

if (config.NODE_ENV === "production" && config.EMAIL_OTP_PROVIDER === "mock") {
  throw new Error("EMAIL_OTP_PROVIDER=mock is not permitted in production");
}
if (config.EMAIL_OTP_PROVIDER === "resend" && !config.RESEND_API_KEY) {
  throw new Error("Resend email OTP requires RESEND_API_KEY");
}
if (config.COOKIE_SAME_SITE === "none" && !config.COOKIE_SECURE) {
  throw new Error("COOKIE_SAME_SITE=none requires COOKIE_SECURE=true");
}
