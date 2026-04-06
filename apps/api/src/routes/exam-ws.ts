import { Elysia, t } from "elysia";
import { verifyToken } from "@clerk/backend";
import { and, eq } from "drizzle-orm";
import { env } from "#/lib/env";
import { wsLogger as log } from "#/lib/logger";
import { getSubscriber, channels } from "#/lib/pubsub";
import { db } from "#/db";
import { exams, examSessions } from "#/db/schema";
import type { WsClientMessage } from "@repo/shared";

// ============================================
// WebSocket Route for Exam Real-Time Events
// ============================================
// Clients connect with ?token=<clerk_session_token>
// and subscribe to exam/session channels.
//
// Client → Server messages:
//   { type: "ping" }
//   { type: "submit_exam", sessionId: string }
//   { type: "subscribe_exam", examId: string }
//   { type: "subscribe_session", sessionId: string }
//   { type: "unsubscribe_exam", examId: string }
//   { type: "unsubscribe_session", sessionId: string }
//
// Server → Client messages:
//   All WsServerMessage types (generation, timer, grading)

// ============================================
// Connection tracking
// ============================================

type WsConnection = {
  userId: string;
  subscribedChannels: Set<string>;
  send: (data: string) => void;
};

// Map<wsId, WsConnection> — tracks all active connections
const connections = new Map<string, WsConnection>();

// Map<channel, Set<wsId>> — reverse index for channel → connections
const channelSubscribers = new Map<string, Set<string>>();

// ============================================
// Redis subscriber setup (singleton)
// ============================================

let redisListenerAttached = false;

function ensureRedisListener(): void {
  if (redisListenerAttached) return;
  redisListenerAttached = true;

  const sub = getSubscriber();

  sub.on("message", (channel: string, rawMessage: string) => {
    const wsIds = channelSubscribers.get(channel);
    if (!wsIds || wsIds.size === 0) return;

    // Forward to all connected clients subscribed to this channel
    for (const wsId of wsIds) {
      const conn = connections.get(wsId);
      if (conn) {
        try {
          conn.send(rawMessage);
        } catch (err) {
          log.error({ err, wsId, channel }, "Failed to send to WS client");
        }
      }
    }
  });

  log.info("Redis pub/sub listener attached");
}

// ============================================
// Channel subscription management
// ============================================

async function subscribeToChannel(
  wsId: string,
  channel: string,
): Promise<void> {
  const conn = connections.get(wsId);
  if (!conn) return;

  conn.subscribedChannels.add(channel);

  if (!channelSubscribers.has(channel)) {
    channelSubscribers.set(channel, new Set());
    // First subscriber for this channel — subscribe in Redis
    await getSubscriber().subscribe(channel);
    log.debug({ channel }, "Redis subscribed to channel");
  }

  channelSubscribers.get(channel)!.add(wsId);
}

async function unsubscribeFromChannel(
  wsId: string,
  channel: string,
): Promise<void> {
  const conn = connections.get(wsId);
  if (conn) {
    conn.subscribedChannels.delete(channel);
  }

  const subs = channelSubscribers.get(channel);
  if (subs) {
    subs.delete(wsId);
    if (subs.size === 0) {
      channelSubscribers.delete(channel);
      // Last subscriber gone — unsubscribe from Redis
      await getSubscriber().unsubscribe(channel);
      log.debug({ channel }, "Redis unsubscribed from channel");
    }
  }
}

async function cleanupConnection(wsId: string): Promise<void> {
  const conn = connections.get(wsId);
  if (!conn) return;

  // Unsubscribe from all channels
  for (const channel of conn.subscribedChannels) {
    await unsubscribeFromChannel(wsId, channel);
  }

  connections.delete(wsId);
  log.debug({ wsId, userId: conn.userId }, "Connection cleaned up");
}

// ============================================
// Auth helper
// ============================================

async function authenticateToken(
  token: string,
): Promise<{ userId: string } | null> {
  try {
    const config = env();
    const payload = await verifyToken(token, {
      secretKey: config.clerk.secretKey,
      jwtKey: config.clerk.jwtKey,
      authorizedParties: config.clerk.authorizedParties,
    });

    if (payload.sub) {
      return { userId: payload.sub };
    }

    return null;
  } catch (err) {
    log.error({ err }, "Token verification failed");
    return null;
  }
}

async function canSubscribeExam(
  examId: string,
  userId: string,
): Promise<boolean> {
  const exam = await db.query.exams.findFirst({
    where: and(eq(exams.id, examId), eq(exams.userId, userId)),
  });
  return !!exam;
}

async function canSubscribeSession(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const session = await db.query.examSessions.findFirst({
    where: and(eq(examSessions.id, sessionId), eq(examSessions.userId, userId)),
  });
  return !!session;
}

// ============================================
// WebSocket counter for unique IDs
// ============================================

let wsCounter = 0;

// ============================================
// Elysia WebSocket Route
// ============================================

export const examWsRoutes = new Elysia({ prefix: "/ws" }).ws("/exams", {
  query: t.Object({
    token: t.String(),
  }),

  // ----------------------------------------
  // Authenticate before upgrading to WS
  // ----------------------------------------
  async beforeHandle({ query, set }) {
    const auth = await authenticateToken(query.token);
    if (!auth) {
      set.status = 401;
      return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
    }
  },

  // ----------------------------------------
  // Connection opened
  // ----------------------------------------
  async open(ws) {
    const token = ws.data.query.token;
    const auth = await authenticateToken(token);
    if (!auth) {
      ws.close(4001, "Unauthorized");
      return;
    }

    ensureRedisListener();

    const wsId = `ws_${++wsCounter}_${Date.now()}`;
    // Store wsId on the ws raw data for later reference
    (ws.data as Record<string, unknown>).__wsId = wsId;
    (ws.data as Record<string, unknown>).__userId = auth.userId;

    connections.set(wsId, {
      userId: auth.userId,
      subscribedChannels: new Set(),
      send: (data: string) => ws.send(data),
    });

    // Auto-subscribe to user channel for broadcasts
    await subscribeToChannel(wsId, channels.user(auth.userId));

    log.info({ wsId, userId: auth.userId }, "WS connection opened");

    ws.send(JSON.stringify({ type: "connected", userId: auth.userId }));
  },

  // ----------------------------------------
  // Message received from client
  // ----------------------------------------
  async message(ws, rawMessage) {
    const wsId = (ws.data as Record<string, unknown>).__wsId as string;
    const userId = (ws.data as Record<string, unknown>).__userId as string;

    if (!wsId || !userId) {
      ws.close(4001, "Not authenticated");
      return;
    }

    let msg: WsClientMessage & {
      type: string;
      examId?: string;
      sessionId?: string;
    };

    try {
      msg =
        typeof rawMessage === "string"
          ? JSON.parse(rawMessage)
          : (rawMessage as typeof msg);
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    switch (msg.type) {
      case "ping":
        ws.send(JSON.stringify({ type: "pong" }));
        break;

      case "subscribe_exam":
        if (msg.examId) {
          const allowed = await canSubscribeExam(msg.examId, userId);
          if (!allowed) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Not authorized for this exam channel",
              }),
            );
            break;
          }

          await subscribeToChannel(wsId, channels.exam(msg.examId));
          ws.send(
            JSON.stringify({
              type: "subscribed",
              channel: `exam:${msg.examId}`,
            }),
          );
        }
        break;

      case "subscribe_session":
        if (msg.sessionId) {
          const allowed = await canSubscribeSession(msg.sessionId, userId);
          if (!allowed) {
            ws.send(
              JSON.stringify({
                type: "error",
                message: "Not authorized for this session channel",
              }),
            );
            break;
          }

          await subscribeToChannel(wsId, channels.session(msg.sessionId));
          ws.send(
            JSON.stringify({
              type: "subscribed",
              channel: `session:${msg.sessionId}`,
            }),
          );
        }
        break;

      case "unsubscribe_exam":
        if (msg.examId) {
          await unsubscribeFromChannel(wsId, channels.exam(msg.examId));
        }
        break;

      case "unsubscribe_session":
        if (msg.sessionId) {
          await unsubscribeFromChannel(wsId, channels.session(msg.sessionId));
        }
        break;

      default:
        log.warn({ wsId, type: msg.type }, "Unknown WS message type");
    }
  },

  // ----------------------------------------
  // Connection closed
  // ----------------------------------------
  async close(ws) {
    const wsId = (ws.data as Record<string, unknown>).__wsId as string;
    if (wsId) {
      await cleanupConnection(wsId);
    }
    log.info({ wsId }, "WS connection closed");
  },
});
