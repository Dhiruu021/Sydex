import { randomInt } from "node:crypto";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { redis } from "../lib/redis.js";

const emailKey = (email: string) => `otp:email:${email.toLowerCase()}`;

export async function sendOtp(email: string): Promise<void> {
  const code = String(randomInt(100000, 1_000_000));
  const key = emailKey(email);
  await redis.set(key, code, "EX", config.OTP_TTL_SECONDS);
  if (config.EMAIL_OTP_PROVIDER === "mock") {
    logger.info({ email, otp: code }, "Development email OTP issued");
    return;
  }
  const isBrevo = config.EMAIL_OTP_PROVIDER === "brevo";
  const provider = isBrevo ? "brevo" : "resend";
  try {
    const response = await fetch(isBrevo ? "https://api.brevo.com/v3/smtp/email" : "https://api.resend.com/emails", {
      method: "POST",
      headers: {
        ...(isBrevo ? { "api-key": config.BREVO_API_KEY! } : { Authorization: `Bearer ${config.RESEND_API_KEY}` }),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(isBrevo ? {
        sender: { name: config.EMAIL_FROM_NAME, email: config.EMAIL_FROM },
        to: [{ email }],
        subject: "Your Sydex verification code",
        textContent: `Your Sydex verification code is ${code}. It expires in ${Math.ceil(config.OTP_TTL_SECONDS / 60)} minutes. If you did not request this code, you can ignore this email.`,
        htmlContent: `<p>Your Sydex verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>It expires in ${Math.ceil(config.OTP_TTL_SECONDS / 60)} minutes. If you did not request this code, you can ignore this email.</p>`
      } : {
        from: config.EMAIL_FROM,
        to: [email],
        subject: "Your Sydex verification code",
        text: `Your Sydex verification code is ${code}. It expires in ${Math.ceil(config.OTP_TTL_SECONDS / 60)} minutes. If you did not request this code, you can ignore this email.`,
        html: `<p>Your Sydex verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>It expires in ${Math.ceil(config.OTP_TTL_SECONDS / 60)} minutes. If you did not request this code, you can ignore this email.</p>`
      })
    });
    if (!response.ok) {
      const providerError = await response.json().catch(() => null) as { code?: unknown; message?: unknown } | null;
      logger.error({
        provider,
        status: response.status,
        code: typeof providerError?.code === "string" ? providerError.code : undefined,
        message: typeof providerError?.message === "string" ? providerError.message : undefined
      }, "Email provider rejected verification email");
      await redis.del(key).catch((error: unknown) => logger.warn({ err: error }, "Could not clear failed email OTP"));
      throw Object.assign(
        new Error("Could not send the verification email. Check the Brevo API key and verified sender address."),
        { statusCode: 502 }
      );
    }
  } catch (error) {
    await redis.del(key).catch((redisError: unknown) => logger.warn({ err: redisError }, "Could not clear failed email OTP"));
    if (error instanceof Error && "statusCode" in error) throw error;
    logger.error({ err: error, provider }, "Could not reach email provider");
    throw Object.assign(
      new Error("Could not reach the email provider. Check the provider configuration and try again."),
      { statusCode: 502 }
    );
  }
}

export async function verifyOtp(email: string, code: string): Promise<boolean> {
  const key = emailKey(email);
  const savedCode = await redis.get(key);
  if (savedCode !== code) return false;
  await redis.del(key);
  return true;
}
