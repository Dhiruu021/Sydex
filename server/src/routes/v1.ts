import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import * as auth from "../controllers/authController.js";
import * as chat from "../controllers/chatController.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { authenticate } from "../middleware/authenticate.js";
import { config } from "../config.js";
import { redisCommand } from "../lib/redis.js";

export const v1Router = Router();

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many verification attempts. Try again later." },
  ...(config.NODE_ENV === "test"
    ? {}
    : { store: new RedisStore({ sendCommand: redisCommand, prefix: "sydex:otp:rate-limit:" }) })
});

v1Router.post("/auth/request-otp", otpLimiter, asyncHandler(auth.requestOtp));
v1Router.post("/auth/verify-otp", otpLimiter, asyncHandler(auth.verifyOtp));
v1Router.post("/auth/refresh", asyncHandler(auth.refresh));
v1Router.post("/auth/logout", authenticate, asyncHandler(auth.logout));
v1Router.post("/auth/logout-all", authenticate, asyncHandler(auth.logoutAll));
v1Router.delete("/auth/account", authenticate, asyncHandler(auth.deleteAccount));
v1Router.get("/auth/sessions", authenticate, asyncHandler(auth.listSessions));
v1Router.delete("/auth/sessions/:id", authenticate, asyncHandler(auth.deleteSession));
v1Router.get("/profile", authenticate, asyncHandler(auth.getProfile));
v1Router.patch("/profile", authenticate, asyncHandler(auth.updateProfile));
v1Router.get("/users/lookup", authenticate, asyncHandler(chat.lookupDirectoryUser));
v1Router.get("/users", authenticate, asyncHandler(chat.listDirectory));
v1Router.get("/conversations", authenticate, asyncHandler(chat.listConversations));
v1Router.post("/conversations/direct", authenticate, asyncHandler(chat.createDirectConversation));
v1Router.post("/conversations/groups", authenticate, asyncHandler(chat.createGroupConversation));
v1Router.get("/conversations/:id/messages", authenticate, asyncHandler(chat.listMessages));
v1Router.post("/conversations/:id/messages", authenticate, asyncHandler(chat.sendMessage));
