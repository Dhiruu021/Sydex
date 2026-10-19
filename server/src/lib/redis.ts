import { Redis } from "ioredis";
import { config } from "../config.js";
import { logger } from "./logger.js";

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  retryStrategy: (attempt) => (attempt <= 5 ? attempt * 500 : null)
});

let lastReportedError = "";
redis.on("error", (error: NodeJS.ErrnoException) => {
  const signature = `${error.code ?? error.name}:${error.message}`;
  if (signature === lastReportedError) return;
  lastReportedError = signature;
  logger.warn(
    { code: error.code },
    "Redis is unavailable; start Redis and verify REDIS_URL in the root .env"
  );
});

type RedisScalar = boolean | number | string;
type RedisReply = RedisScalar | RedisScalar[];

function isRedisReply(value: unknown): value is RedisReply {
  return (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    (Array.isArray(value) &&
      value.every((item) =>
        typeof item === "boolean" || typeof item === "number" || typeof item === "string"
      ))
  );
}

export async function redisCommand(command: string, ...args: string[]): Promise<RedisReply> {
  const reply: unknown = await redis.call(command, ...args);
  if (!isRedisReply(reply)) throw new Error("Redis returned an unsupported reply to a rate-limit command");
  return reply;
}
