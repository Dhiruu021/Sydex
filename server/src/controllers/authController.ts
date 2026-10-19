import type { Request, Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { Session } from "../models/Session.js";
import { User } from "../models/User.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { emitToUsers } from "../lib/chatSocket.js";
import { completeLogin, revokeAllSessions, revokeSession, rotateRefreshToken } from "../services/authService.js";
import { sendOtp } from "../services/otpProvider.js";

const emailSchema = z.string().trim().email("Enter a valid email address").max(254).transform((email) => email.toLowerCase());
const refreshCookie = "sydex_refresh";
const refreshCookieOptions = {
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: config.COOKIE_SAME_SITE,
  path: "/api/v1/auth",
  maxAge: config.REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000
};

export async function requestOtp(req: Request, res: Response): Promise<void> {
  const input = z.object({ email: emailSchema }).parse(req.body);
  await sendOtp(input.email);
  res.status(202).json({ message: "A verification code has been sent to your email." });
}

export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const input = z.object({
    email: emailSchema,
    code: z.string().regex(/^\d{6}$/),
    deviceName: z.string().trim().min(1).max(120).default("Web browser")
  }).parse(req.body);
  const result = await completeLogin(input);
  res.cookie(refreshCookie, result.refreshToken, refreshCookieOptions);
  res.json({ accessToken: result.accessToken, user: result.user });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies[refreshCookie];
  if (typeof token !== "string") {
    res.status(401).json({ error: "Refresh token required" });
    return;
  }
  const result = await rotateRefreshToken(token);
  res.cookie(refreshCookie, result.refreshToken, refreshCookieOptions);
  res.json({ accessToken: result.accessToken, user: result.user });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token = req.cookies[refreshCookie];
  if (token) {
    const jwt = await import("jsonwebtoken");
    try {
      const payload = jwt.default.verify(token, config.JWT_REFRESH_SECRET);
      if (typeof payload !== "string" && payload.sub) await revokeSession(payload.sub, req.userId!);
    } catch {
      // An already-expired token is still cleared from this browser.
    }
  }
  res.clearCookie(refreshCookie, { ...refreshCookieOptions, maxAge: undefined });
  res.status(204).end();
}

export async function logoutAll(req: Request, res: Response): Promise<void> {
  await revokeAllSessions(req.userId!);
  res.clearCookie(refreshCookie, { ...refreshCookieOptions, maxAge: undefined });
  res.status(204).end();
}

export async function listSessions(req: Request, res: Response): Promise<void> {
  const sessions = await Session.find({ userId: req.userId }).sort({ lastActiveAt: -1 }).lean();
  const currentToken = req.cookies[refreshCookie];
  let currentId: string | undefined;
  if (typeof currentToken === "string") {
    const jwt = await import("jsonwebtoken");
    try {
      const payload = jwt.default.verify(currentToken, config.JWT_REFRESH_SECRET);
      if (typeof payload !== "string") currentId = payload.sub;
    } catch {
      currentId = undefined;
    }
  }
  res.json({
    sessions: sessions.map((session) => ({
      id: session._id.toString(),
      deviceName: session.deviceName,
      createdAt: session.createdAt.toISOString(),
      lastActiveAt: session.lastActiveAt.toISOString(),
      current: session._id.toString() === currentId
    }))
  });
}

export async function deleteSession(req: Request, res: Response): Promise<void> {
  const id = z.string().regex(/^[a-f\d]{24}$/i).parse(req.params.id);
  await revokeSession(id, req.userId!);
  res.status(204).end();
}

export async function getProfile(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.userId).orFail();
  res.json({ user: serializeUser(user) });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const input = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    about: z.string().trim().max(139).optional(),
    avatarUrl: z.string().url().nullable().optional(),
    privacy: z.object({
      lastSeen: z.enum(["everyone", "contacts", "nobody"]).optional(),
      profilePhoto: z.enum(["everyone", "contacts", "nobody"]).optional(),
      about: z.enum(["everyone", "contacts", "nobody"]).optional(),
      readReceipts: z.boolean().optional()
    }).partial().optional()
  }).refine((value) => Object.keys(value).length > 0, "Provide at least one field to update").parse(req.body);

  const set: Record<string, unknown> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.about !== undefined) set.about = input.about;
  if (input.avatarUrl !== undefined) set.avatarUrl = input.avatarUrl;
  for (const [key, value] of Object.entries(input.privacy ?? {})) set[`privacy.${key}`] = value;
  const user = await User.findByIdAndUpdate(req.userId, { $set: set }, { new: true, runValidators: true }).orFail();
  res.json({ user: serializeUser(user) });
}

export async function deleteAccount(req: Request, res: Response): Promise<void> {
  const accountId = req.userId!;
  const conversations = await Conversation.find({ participants: accountId });

  for (const conversation of conversations) {
    const otherParticipants = conversation.participants
      .filter((participant) => participant.toString() !== accountId)
      .map((participant) => participant.toString());

    if (conversation.kind === "direct") {
      emitToUsers(otherParticipants, "chat:conversation-deleted", { conversationId: conversation.id });
      await Message.deleteMany({ conversationId: conversation._id });
      await Conversation.deleteOne({ _id: conversation._id });
      continue;
    }

    await Message.deleteMany({ conversationId: conversation._id, senderId: accountId });
    if (otherParticipants.length < 2) {
      emitToUsers(otherParticipants, "chat:conversation-deleted", { conversationId: conversation.id });
      await Message.deleteMany({ conversationId: conversation._id });
      await Conversation.deleteOne({ _id: conversation._id });
      continue;
    }

    conversation.participants = conversation.participants.filter((participant) => participant.toString() !== accountId);
    if (conversation.createdBy.toString() === accountId) conversation.createdBy = conversation.participants[0]!;
    const latestMessage = await Message.findOne({ conversationId: conversation._id }).sort({ createdAt: -1, _id: -1 });
    conversation.lastMessageId = latestMessage?._id ?? null;
    conversation.lastMessageSenderId = latestMessage?.senderId ?? null;
    conversation.lastMessageText = latestMessage
      ? latestMessage.text || (latestMessage.imageData ? "📷 Photo" : latestMessage.audioData ? "🎤 Voice message" : "Voice call")
      : "";
    conversation.lastMessageAt = latestMessage?.createdAt ?? new Date(0);
    await conversation.save();
    emitToUsers(otherParticipants, "chat:messages-deleted", { conversationId: conversation.id });
    emitToUsers(otherParticipants, "chat:conversation", { id: conversation.id });
  }

  await Session.deleteMany({ userId: accountId });
  await User.deleteOne({ _id: accountId });
  res.clearCookie(refreshCookie, { ...refreshCookieOptions, maxAge: undefined });
  res.status(204).end();
}

function serializeUser(user: InstanceType<typeof User>) {
  return {
    id: user.id,
    email: user.email ?? "",
    name: user.name,
    about: user.about,
    avatarUrl: user.avatarUrl,
    privacy: user.privacy,
    createdAt: user.createdAt.toISOString()
  };
}
