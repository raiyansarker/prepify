import Redis from "ioredis";
import { env } from "#/lib/env";
import { pubsubLogger as log } from "#/lib/logger";
import type { WsServerMessage } from "@repo/shared";

// ============================================
// Redis Pub/Sub for WebSocket Event Forwarding
// ============================================
// Workers publish events to Redis channels.
// The WS server subscribes and forwards messages
// to connected clients.
//
// Channel naming:
//   exam:<examId>       — generation progress events
//   session:<sessionId> — timer sync, grading events
//   user:<userId>       — user-scoped fallback

// ============================================
// Dedicated publisher & subscriber connections
// ============================================
// Redis requires separate connections for pub/sub
// because a subscribed client can only run
// SUBSCRIBE / UNSUBSCRIBE / PSUBSCRIBE / PUNSUBSCRIBE.

let _pub: Redis | null = null;
let _sub: Redis | null = null;

function createRedisClient(label: string): Redis {
  const client = new Redis(env().redis.url, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  client.on("error", (err: unknown) => {
    log.error({ err, label }, "Redis connection error");
  });

  client.on("connect", () => {
    log.info({ label }, "Redis connected");
  });

  return client;
}

export function getPublisher(): Redis {
  if (!_pub) {
    _pub = createRedisClient("pub");
    _pub.connect().catch((err: unknown) => {
      log.error({ err }, "Failed to connect publisher");
    });
  }
  return _pub;
}

export function getSubscriber(): Redis {
  if (!_sub) {
    _sub = createRedisClient("sub");
    _sub.connect().catch((err: unknown) => {
      log.error({ err }, "Failed to connect subscriber");
    });
  }
  return _sub;
}

// ============================================
// Channel helpers
// ============================================

export const channels = {
  exam: (examId: string) => `exam:${examId}`,
  session: (sessionId: string) => `session:${sessionId}`,
  user: (userId: string) => `user:${userId}`,
} as const;

// ============================================
// Publish helper (used by workers)
// ============================================

export async function publishEvent(
  channel: string,
  message: WsServerMessage,
): Promise<void> {
  try {
    await getPublisher().publish(channel, JSON.stringify(message));
    log.debug({ channel, type: message.type }, "Published event");
  } catch (err) {
    log.error({ err, channel }, "Failed to publish event");
  }
}

// ============================================
// Cleanup
// ============================================

export async function closePubSub(): Promise<void> {
  await Promise.all([_pub?.quit(), _sub?.quit()]);
  _pub = null;
  _sub = null;
}
