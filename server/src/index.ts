import { createServer } from "node:http";
import mongoose from "mongoose";
import { config } from "./config.js";
import { initializeChatSocket } from "./lib/chatSocket.js";
import { logger } from "./lib/logger.js";
import { redis } from "./lib/redis.js";
import { User } from "./models/User.js";

async function start(): Promise<void> {
  try {
    await mongoose.connect(config.MONGODB_URI);
  } catch (error) {
    if (isAtlasDnsError(error)) {
      throw new Error(
        "Could not resolve the MongoDB Atlas SRV record. Check your internet/DNS/VPN connection and verify the cluster hostname in MONGODB_URI."
      );
    }
    throw new Error(
      "Could not connect to MongoDB. Verify that MongoDB is running and MONGODB_URI in the root .env is correct."
    );
  }

  const indexes = await User.collection.indexes();
  // Old phone-only accounts had a unique phone index; remove it so email-only accounts can be created.
  if (indexes.some((index) => index.name === "phone_1")) await User.collection.dropIndex("phone_1");
  await User.createIndexes();

  try {
    await redis.ping();
  } catch {
    redis.disconnect();
    await mongoose.disconnect();
    throw new Error(
      "Could not connect to Redis. Start Redis and verify REDIS_URL in the root .env."
    );
  }

  const { app } = await import("./app.js");
  const server = createServer(app);
  initializeChatSocket(server);
  server.listen(config.PORT, () => logger.info({ port: config.PORT }, "Sydex API listening"));
}

function isAtlasDnsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; syscall?: unknown };
  return candidate.code === "EREFUSED" && candidate.syscall === "querySrv";
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unexpected startup failure";
  logger.fatal({ message }, "Sydex API startup failed");
  redis.disconnect();
  void mongoose.disconnect();
  process.exitCode = 1;
});
