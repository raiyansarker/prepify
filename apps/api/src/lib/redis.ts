import type { ConnectionOptions } from "bullmq";

// ============================================
// Redis Connection for BullMQ
// ============================================

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const parsed = new URL(redisUrl);

export const redisConnection: ConnectionOptions = {
  host: parsed.hostname,
  port: Number(parsed.port) || 6379,
  password: parsed.password || undefined,
  db: Number(parsed.pathname?.slice(1)) || 0,
};
