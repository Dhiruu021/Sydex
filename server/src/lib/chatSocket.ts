import type { Server as HttpServer } from "node:http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";
import { config } from "../config.js";
import { allowClientOrigin } from "./clientOrigin.js";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";

let chatIo: Server | undefined;
type CallStatus = "completed" | "missed" | "declined" | "cancelled";
type CallSession = { conversationId: string; callerUserId: string; calleeUserId: string; acceptedAt: number | null; timer: ReturnType<typeof setTimeout> };
const callSessions = new Map<string, CallSession>();

function callKey(conversationId: string, firstUserId: string, secondUserId: string): string {
  return `${conversationId}:${[firstUserId, secondUserId].sort().join(":")}`;
}

async function saveCallHistory(session: CallSession, status: CallStatus): Promise<void> {
  const conversation = await Conversation.findById(session.conversationId);
  if (!conversation) return;
  const duration = status === "completed" && session.acceptedAt !== null
    ? Math.max(0, Math.floor((Date.now() - session.acceptedAt) / 1000)) : 0;
  const text = status === "completed" ? "Voice call" : status === "missed" ? "Missed voice call"
    : status === "declined" ? "Declined voice call" : "Cancelled voice call";
  const message = await Message.create({ conversationId: session.conversationId, senderId: session.callerUserId, text, callStatus: status, callDurationSeconds: duration });
  conversation.lastMessageText = text;
  conversation.lastMessageId = message._id;
  conversation.lastMessageSenderId = message.senderId;
  conversation.lastMessageAt = message.createdAt;
  await conversation.save();
  const serialized = { id: message.id, conversationId: session.conversationId, senderId: session.callerUserId, text, imageData: null, audioData: null, callStatus: status, callDurationSeconds: duration, createdAt: message.createdAt.toISOString() };
  const participantIds = conversation.participants.map((participant) => participant.toString());
  emitToUsers(participantIds, "chat:message", { conversationId: session.conversationId, message: serialized });
  emitToUsers(participantIds, "chat:conversation", { id: session.conversationId });
}

export function initializeChatSocket(server: HttpServer): void {
  chatIo = new Server(server, {
    cors: {
      origin: allowClientOrigin,
      credentials: true
    }
  });

  chatIo.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (typeof token !== "string") {
      next(new Error("Authentication required"));
      return;
    }

    try {
      const payload = jwt.verify(token, config.JWT_ACCESS_SECRET);
      if (typeof payload === "string" || typeof payload.sub !== "string") {
        next(new Error("Invalid access token"));
        return;
      }
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error("Invalid or expired access token"));
    }
  });

  chatIo.on("connection", (socket) => {
    socket.join(`user:${socket.data.userId as string}`);
    const callerId = socket.data.userId as string;
    const forwardToPeer = async (event: string, payload: unknown) => {
      if (typeof payload !== "object" || payload === null) return;
      const data = payload as { conversationId?: unknown; targetUserId?: unknown };
      if (typeof data.conversationId !== "string" || !/^[a-f\d]{24}$/i.test(data.conversationId)) return;
      if (typeof data.targetUserId !== "string" || !/^[a-f\d]{24}$/i.test(data.targetUserId) || data.targetUserId === callerId) return;
      const conversation = await Conversation.findOne({
        _id: data.conversationId,
        kind: "direct",
        participants: { $all: [callerId, data.targetUserId], $size: 2 }
      }).select("_id").lean();
      if (!conversation) return;
      const { conversationId, targetUserId, ...signal } = data;
      chatIo?.to(`user:${data.targetUserId}`).emit(event, { conversationId, callerUserId: callerId, signal });
    };

    socket.on("call:invite", async (payload: unknown) => {
      try {
        if (typeof payload !== "object" || payload === null) return;
        const offer = (payload as { offer?: unknown }).offer;
        if (typeof offer !== "object" || offer === null || (offer as { type?: unknown }).type !== "offer" || typeof (offer as { sdp?: unknown }).sdp !== "string" || (offer as { sdp: string }).sdp.length > 100000) return;
        const data = payload as { conversationId?: unknown; targetUserId?: unknown };
        if (typeof data.conversationId !== "string" || !/^[a-f\d]{24}$/i.test(data.conversationId) || typeof data.targetUserId !== "string" || !/^[a-f\d]{24}$/i.test(data.targetUserId) || data.targetUserId === callerId) return;
        const conversation = await Conversation.findOne({ _id: data.conversationId, kind: "direct", participants: { $all: [callerId, data.targetUserId], $size: 2 } }).select("_id").lean();
        if (!conversation) return;
        const key = callKey(data.conversationId, callerId, data.targetUserId);
        const previous = callSessions.get(key);
        if (previous) { clearTimeout(previous.timer); callSessions.delete(key); }
        let session: CallSession;
        session = { conversationId: data.conversationId, callerUserId: callerId, calleeUserId: data.targetUserId, acceptedAt: null, timer: setTimeout(() => {
          if (callSessions.get(key) !== session) return;
          callSessions.delete(key);
          void saveCallHistory(session, "missed").catch(() => undefined);
          chatIo?.to(`user:${session.callerUserId}`).emit("call:ended", { conversationId: session.conversationId, callerUserId: session.calleeUserId });
          chatIo?.to(`user:${session.calleeUserId}`).emit("call:ended", { conversationId: session.conversationId, callerUserId: session.callerUserId });
        }, 60_000) };
        callSessions.set(key, session);
        const caller = await User.findById(callerId).select("name email").lean();
        chatIo?.to(`user:${data.targetUserId}`).emit("call:incoming", {
          conversationId: data.conversationId,
          callerUserId: callerId,
          callerName: caller?.name ?? "Sydex user",
          callerEmail: caller?.email ?? "",
          offer
        });
      } catch { /* Ignore invalid or stale call invitations. */ }
    });

    socket.on("call:accept", async (payload: unknown) => {
      try {
        if (typeof payload !== "object" || payload === null) return;
        const answer = (payload as { answer?: unknown }).answer;
        if (typeof answer !== "object" || answer === null || (answer as { type?: unknown }).type !== "answer" || typeof (answer as { sdp?: unknown }).sdp !== "string" || (answer as { sdp: string }).sdp.length > 100000) return;
        const data = payload as { conversationId?: unknown; targetUserId?: unknown };
        if (typeof data.conversationId !== "string" || typeof data.targetUserId !== "string") return;
        const session = callSessions.get(callKey(data.conversationId, callerId, data.targetUserId));
        if (!session || callerId !== session.calleeUserId || data.targetUserId !== session.callerUserId) return;
        clearTimeout(session.timer);
        session.acceptedAt = Date.now();
        await forwardToPeer("call:accepted", payload);
      } catch { /* Ignore invalid or stale call answers. */ }
    });

    socket.on("call:ice", async (payload: unknown) => {
      try {
        if (typeof payload !== "object" || payload === null) return;
        const candidate = (payload as { candidate?: unknown }).candidate;
        if (typeof candidate !== "object" || candidate === null || JSON.stringify(candidate).length > 10000) return;
        await forwardToPeer("call:ice", payload);
      } catch { /* Ignore invalid call candidates. */ }
    });

    socket.on("call:end", async (payload: unknown) => {
      try {
        if (typeof payload !== "object" || payload === null) return;
        const data = payload as { conversationId?: unknown; targetUserId?: unknown };
        if (typeof data.conversationId !== "string" || typeof data.targetUserId !== "string") return;
        const key = callKey(data.conversationId, callerId, data.targetUserId);
        const session = callSessions.get(key);
        if (!session) return;
        clearTimeout(session.timer);
        callSessions.delete(key);
        await forwardToPeer("call:ended", payload);
        const status: CallStatus = session.acceptedAt !== null ? "completed" : callerId === session.calleeUserId ? "declined" : "cancelled";
        await saveCallHistory(session, status);
      }
      catch { /* Ignore stale call endings. */ }
    });

    socket.on("disconnect", () => {
      for (const [key, session] of callSessions) {
        if (callerId !== session.callerUserId && callerId !== session.calleeUserId) continue;
        clearTimeout(session.timer);
        callSessions.delete(key);
        const peerId = callerId === session.callerUserId ? session.calleeUserId : session.callerUserId;
        const status: CallStatus = session.acceptedAt !== null ? "completed" : callerId === session.callerUserId ? "cancelled" : "missed";
        void saveCallHistory(session, status).catch(() => undefined);
        chatIo?.to(`user:${peerId}`).emit("call:ended", { conversationId: session.conversationId, callerUserId: callerId });
      }
    });
  });
}

export function emitToUsers(userIds: string[], event: string, payload: unknown): void {
  if (!chatIo || userIds.length === 0) return;
  chatIo.to(userIds.map((userId) => `user:${userId}`)).emit(event, payload);
}
