import mongoose from "mongoose";
import type { Request, Response } from "express";
import { z } from "zod";
import { Conversation } from "../models/Conversation.js";
import { Message } from "../models/Message.js";
import { User } from "../models/User.js";
import { emitToUsers } from "../lib/chatSocket.js";

const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i);
const userId = (req: Request): string => req.userId!;

export async function listDirectory(req: Request, res: Response): Promise<void> {
  const query = z.object({ search: z.string().trim().max(80).optional() }).parse(req.query);
  const filter: Record<string, unknown> = { _id: { $ne: userId(req) }, email: { $type: "string", $ne: "" } };
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { name: { $regex: escaped, $options: "i" } },
      { email: { $regex: escaped, $options: "i" } }
    ];
  }
  const users = await User.find(filter).select("name email avatarUrl").sort({ name: 1, _id: 1 }).limit(500).lean();
  res.json({
    users: users.map((user) => ({
      id: user._id.toString(),
      name: user.name,
      email: user.email ?? "",
      avatarUrl: user.avatarUrl
    }))
  });
}

export async function lookupDirectoryUser(req: Request, res: Response): Promise<void> {
  const email = z.string().trim().email("Enter a valid email address").max(254).transform((value) => value.toLowerCase()).parse(req.query.email);
  const user = await User.findOne({ email, _id: { $ne: userId(req) } })
    .select("name email avatarUrl")
    .lean();

  if (!user) {
    throw Object.assign(new Error("No Sydex account is registered with this email"), { statusCode: 404 });
  }

  res.json({
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email ?? "",
      avatarUrl: user.avatarUrl
    }
  });
}

export async function listConversations(req: Request, res: Response): Promise<void> {
  const conversations = await Conversation.find({ participants: userId(req) })
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(200)
    .populate("participants", "name email avatarUrl")
    .lean();

  res.json({
    conversations: conversations.map((conversation) => serializeConversation(conversation))
  });
}

export async function createDirectConversation(req: Request, res: Response): Promise<void> {
  const input = z.object({ userId: objectIdSchema }).parse(req.body);
  if (input.userId === userId(req)) {
    throw Object.assign(new Error("You cannot start a conversation with yourself"), { statusCode: 400 });
  }
  const recipient = await User.findById(input.userId).select("_id");
  if (!recipient) throw Object.assign(new Error("User not found"), { statusCode: 404 });

  const participants = [userId(req), input.userId].sort();
  const directKey = participants.join(":");
  let conversation = await Conversation.findOne({ directKey });
  if (!conversation) {
    try {
      conversation = await Conversation.create({
        kind: "direct",
        participants,
        createdBy: userId(req),
        directKey
      });
      const populated = await populateConversation(conversation.id);
      emitToUsers(participants, "chat:conversation", populated);
      res.status(201).json({ conversation: populated });
      return;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      conversation = await Conversation.findOne({ directKey });
      if (!conversation) throw error;
    }
  }

  res.json({ conversation: await populateConversation(conversation.id) });
}

export async function createGroupConversation(req: Request, res: Response): Promise<void> {
  const input = z.object({
    title: z.string().trim().min(1).max(80),
    participantIds: z.array(objectIdSchema).min(2).max(99)
  }).parse(req.body);
  const participants = [...new Set([...input.participantIds, userId(req)])];
  if (participants.length !== input.participantIds.length + 1) {
    throw Object.assign(new Error("Choose each group member only once"), { statusCode: 400 });
  }
  const users = await User.find({ _id: { $in: participants } }).select("_id").lean();
  if (users.length !== participants.length) {
    throw Object.assign(new Error("One or more group members could not be found"), { statusCode: 404 });
  }

  const conversation = await Conversation.create({
    kind: "group",
    title: input.title,
    participants,
    createdBy: userId(req)
  });
  const populated = await populateConversation(conversation.id);
  emitToUsers(participants, "chat:conversation", populated);
  res.status(201).json({ conversation: populated });
}

export async function listMessages(req: Request, res: Response): Promise<void> {
  const conversationId = objectIdSchema.parse(req.params.id);
  const query = z.object({
    before: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50)
  }).parse(req.query);
  await requireMembership(conversationId, userId(req));

  const filter: Record<string, unknown> = { conversationId };
  if (query.before) filter.createdAt = { $lt: new Date(query.before) };
  const messages = await Message.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit)
    .lean();
  res.json({ messages: messages.reverse().map(serializeMessage) });
}

export async function sendMessage(req: Request, res: Response): Promise<void> {
  const conversationId = objectIdSchema.parse(req.params.id);
  const input = z.object({
    text: z.string().trim().max(4000).optional(),
    imageData: z.string().max(120000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/).optional(),
    audioData: z.string().max(1300000).regex(/^data:audio\/[A-Za-z0-9.+-]+(?:;codecs=[A-Za-z0-9.,+-]+)?;base64,[A-Za-z0-9+/]+={0,2}$/).optional()
  }).refine((value) => Boolean(value.text || value.imageData || value.audioData), "Message text, photo, or voice note is required").parse(req.body);
  const conversation = await requireMembership(conversationId, userId(req));
  const message = await Message.create({
    conversationId,
    senderId: userId(req),
    text: input.text ?? "",
    imageData: input.imageData ?? null,
    audioData: input.audioData ?? null
  });
  conversation.lastMessageText = message.text || (message.imageData ? "📷 Photo" : "🎤 Voice message");
  conversation.lastMessageId = message._id;
  conversation.lastMessageSenderId = new mongoose.Types.ObjectId(userId(req));
  conversation.lastMessageAt = message.createdAt;
  await conversation.save();

  const response = serializeMessage(message.toObject());
  const summary = await populateConversation(conversation.id);
  emitToUsers(
    conversation.participants.map((participant) => participant.toString()),
    "chat:message",
    { conversationId, message: response, conversation: summary }
  );
  res.status(201).json({ message: response });
}

async function requireMembership(conversationId: string, memberId: string) {
  const conversation = await Conversation.findOne({
    _id: conversationId,
    participants: memberId
  });
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { statusCode: 404 });
  }
  return conversation;
}

async function populateConversation(id: string) {
  const conversation = await Conversation.findById(id).populate("participants", "name email avatarUrl").orFail();
  return serializeConversation(conversation.toObject());
}

function serializeConversation(conversation: {
  _id: mongoose.Types.ObjectId;
  kind: "direct" | "group";
  title?: string | null;
  participants: unknown[];
  lastMessageText?: string;
  lastMessageId?: mongoose.Types.ObjectId | null;
  lastMessageSenderId?: mongoose.Types.ObjectId | null;
  lastMessageAt?: Date;
  updatedAt: Date;
}) {
  const participants = conversation.participants as Array<{
    _id: mongoose.Types.ObjectId;
    name: string;
    email: string;
    avatarUrl: string | null;
  }>;
  const lastMessage = conversation.lastMessageText
    ? {
        id: conversation.lastMessageId?.toString() ?? "",
        conversationId: conversation._id.toString(),
        senderId: conversation.lastMessageSenderId?.toString() ?? "",
        text: conversation.lastMessageText,
        createdAt: (conversation.lastMessageAt ?? conversation.updatedAt).toISOString()
      }
    : null;

  return {
    id: conversation._id.toString(),
    kind: conversation.kind,
    title: conversation.title ?? null,
    participants: participants.map((participant) => ({
      id: participant._id.toString(),
      name: participant.name,
      email: participant.email ?? "",
      avatarUrl: participant.avatarUrl
    })),
    lastMessage,
    updatedAt: (conversation.lastMessageAt ?? conversation.updatedAt).toISOString()
  };
}

function serializeMessage(message: {
  _id: mongoose.Types.ObjectId;
  conversationId: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  text: string;
  imageData?: string | null;
  audioData?: string | null;
  callStatus?: "completed" | "missed" | "declined" | "cancelled" | null;
  callDurationSeconds?: number | null;
  createdAt: Date;
}) {
  return {
    id: message._id.toString(),
    conversationId: message.conversationId.toString(),
    senderId: message.senderId.toString(),
    text: message.text,
    imageData: message.imageData ?? null,
    audioData: message.audioData ?? null,
    callStatus: message.callStatus ?? null,
    callDurationSeconds: message.callDurationSeconds ?? null,
    createdAt: message.createdAt.toISOString()
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
