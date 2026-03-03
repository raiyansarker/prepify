import type { ConnectionOptions } from "bullmq";
import { env } from "#/lib/env";

// ============================================
// Redis Connection for BullMQ
// ============================================

const redisUrl = env().redis.url;
const parsed = new URL(redisUrl);

export const redisConnection: ConnectionOptions = {
  host: parsed.hostname,
  port: Number(parsed.port) || 6379,
  password: parsed.password || undefined,
  db: Number(parsed.pathname?.slice(1)) || 0,
};
