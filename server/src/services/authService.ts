import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { config } from "../config.js";
import { Session } from "../models/Session.js";
import { User } from "../models/User.js";
import { verifyOtp } from "./otpProvider.js";

const publicUser = (user: InstanceType<typeof User>) => ({
  id: user.id,
  email: user.email ?? "",
  name: user.name,
  about: user.about,
  avatarUrl: user.avatarUrl,
  privacy: user.privacy,
  createdAt: user.createdAt.toISOString()
});

function createAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.JWT_ACCESS_SECRET, {
    expiresIn: config.ACCESS_TOKEN_TTL as jwt.SignOptions["expiresIn"]
  });
}

function createRefreshToken(sessionId: string): string {
  return jwt.sign({ sub: sessionId }, config.JWT_REFRESH_SECRET, {
    expiresIn: `${config.REFRESH_TOKEN_DAYS}d`
  });
}

export async function completeLogin(input: {
  email: string;
  code: string;
  deviceName: string;
}): Promise<{ accessToken: string; refreshToken: string; user: ReturnType<typeof publicUser> }> {
  if (!(await verifyOtp(input.email, input.code))) {
    throw Object.assign(new Error("Invalid or expired verification code"), { statusCode: 401 });
  }

  const user = await User.findOneAndUpdate(
    { email: input.email },
    { $setOnInsert: { email: input.email } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const sessionId = new mongoose.Types.ObjectId().toString();
  const refreshToken = createRefreshToken(sessionId);
  const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
  const now = new Date();
  await Session.create({
    _id: sessionId,
    userId: user._id,
    refreshTokenHash,
    deviceName: input.deviceName,
    expiresAt: new Date(now.getTime() + config.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000),
    lastActiveAt: now
  });

  return { accessToken: createAccessToken(user.id), refreshToken, user: publicUser(user) };
}

export async function rotateRefreshToken(token: string): Promise<{
  accessToken: string;
  refreshToken: string;
  user: ReturnType<typeof publicUser>;
}> {
  let claims: jwt.JwtPayload;
  try {
    const decoded = jwt.verify(token, config.JWT_REFRESH_SECRET);
    if (typeof decoded === "string" || typeof decoded.sub !== "string") throw new Error("Invalid token");
    claims = decoded;
  } catch {
    throw Object.assign(new Error("Invalid or expired refresh token"), { statusCode: 401 });
  }

  const session = await Session.findById(claims.sub).select("+refreshTokenHash");
  if (!session || session.expiresAt <= new Date() || !(await bcrypt.compare(token, session.refreshTokenHash))) {
    if (session) await Session.deleteOne({ _id: session._id });
    throw Object.assign(new Error("Session expired or revoked"), { statusCode: 401 });
  }

  const user = await User.findById(session.userId);
  if (!user) {
    await Session.deleteOne({ _id: session._id });
    throw Object.assign(new Error("Account no longer exists"), { statusCode: 401 });
  }

  const refreshToken = createRefreshToken(session.id);
  const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
  const rotated = await Session.updateOne(
    { _id: session._id, refreshTokenHash: session.refreshTokenHash },
    { $set: { refreshTokenHash, lastActiveAt: new Date() } }
  );
  if (rotated.modifiedCount !== 1) {
    throw Object.assign(new Error("Refresh token has already been used"), { statusCode: 401 });
  }
  return { accessToken: createAccessToken(user.id), refreshToken, user: publicUser(user) };
}

export async function revokeSession(sessionId: string, userId: string): Promise<void> {
  await Session.deleteOne({ _id: sessionId, userId });
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await Session.deleteMany({ userId });
}
