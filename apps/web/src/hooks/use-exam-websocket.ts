import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "#/lib/api";
import type { WsServerMessage, WsClientMessage } from "@repo/shared";

// ============================================
// Types
// ============================================

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

type ExamGenerationState = {
  examId: string;
  current: number;
  total: number;
  status: "started" | "in_progress" | "complete" | "failed";
  error?: string;
};

type ExamTimerState = {
  sessionId: string;
  remainingSeconds: number;
  endsAt?: string;
  submitted?: boolean;
  submitReason?: "user" | "timeout";
};

type GradingState = {
  sessionId: string;
  current: number;
  total: number;
  status: "started" | "in_progress" | "complete" | "failed";
  error?: string;
};

type UseExamWebSocketReturn = {
  status: ConnectionStatus;
  generation: Map<string, ExamGenerationState>;
  timers: Map<string, ExamTimerState>;
  grading: Map<string, GradingState>;
  subscribeExam: (examId: string) => void;
  unsubscribeExam: (examId: string) => void;
  subscribeSession: (sessionId: string) => void;
  unsubscribeSession: (sessionId: string) => void;
  lastMessage: WsServerMessage | null;
};

// ============================================
// Constants
// ============================================

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const PING_INTERVAL = 25000;

// ============================================
// Build WebSocket URL from API_URL
// ============================================

function getWsUrl(): string {
  const url = new URL(API_URL);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/exams";
  return url.toString();
}

// ============================================
// Hook
// ============================================

export function useExamWebSocket(): UseExamWebSocketReturn {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [generation, setGeneration] = useState<
    Map<string, ExamGenerationState>
  >(new Map());
  const [timers, setTimers] = useState<Map<string, ExamTimerState>>(new Map());
  const [grading, setGrading] = useState<Map<string, GradingState>>(new Map());
  const [lastMessage, setLastMessage] = useState<WsServerMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  // Track subscriptions so we can re-subscribe on reconnect
  const pendingSubscriptionsRef = useRef<Set<string>>(new Set());

  // ------------------------------------------
  // Send helper
  // ------------------------------------------
  const send = useCallback((msg: WsClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // ------------------------------------------
  // Message handler
  // ------------------------------------------
  const handleMessage = useCallback((raw: string) => {
    let parsed: { type: string; [k: string]: unknown };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    // Skip non-data messages (connected, pong, subscribed, error)
    if (
      parsed.type === "connected" ||
      parsed.type === "pong" ||
      parsed.type === "subscribed" ||
      parsed.type === "error"
    ) {
      return;
    }

    const msg = parsed as WsServerMessage;
    setLastMessage(msg);

    // --- Generation messages ---
    if (msg.type === "generation_started") {
      setGeneration((prev) => {
        const next = new Map(prev);
        next.set(msg.examId, {
          examId: msg.examId,
          current: 0,
          total: 0,
          status: "started",
        });
        return next;
      });
    } else if (msg.type === "generation_progress") {
      setGeneration((prev) => {
        const next = new Map(prev);
        next.set(msg.examId, {
          examId: msg.examId,
          current: msg.current,
          total: msg.total,
          status: "in_progress",
        });
        return next;
      });
    } else if (msg.type === "generation_complete") {
      setGeneration((prev) => {
        const next = new Map(prev);
        const existing = prev.get(msg.examId);
        next.set(msg.examId, {
          examId: msg.examId,
          current: existing?.total ?? 0,
          total: existing?.total ?? 0,
          status: "complete",
        });
        return next;
      });
    } else if (msg.type === "generation_failed") {
      setGeneration((prev) => {
        const next = new Map(prev);
        next.set(msg.examId, {
          examId: msg.examId,
          current: 0,
          total: 0,
          status: "failed",
          error: msg.error,
        });
        return next;
      });
    }

    // --- Timer messages ---
    else if (msg.type === "exam_started") {
      setTimers((prev) => {
        const next = new Map(prev);
        next.set(msg.sessionId, {
          sessionId: msg.sessionId,
          remainingSeconds: 0,
          endsAt: msg.endsAt,
        });
        return next;
      });
    } else if (msg.type === "timer_sync") {
      setTimers((prev) => {
        const next = new Map(prev);
        const existing = prev.get(msg.sessionId);
        next.set(msg.sessionId, {
          ...existing,
          sessionId: msg.sessionId,
          remainingSeconds: msg.remainingSeconds,
        });
        return next;
      });
    } else if (msg.type === "exam_submitted") {
      setTimers((prev) => {
        const next = new Map(prev);
        const existing = prev.get(msg.sessionId);
        next.set(msg.sessionId, {
          ...existing,
          sessionId: msg.sessionId,
          remainingSeconds: 0,
          submitted: true,
          submitReason: msg.reason,
        });
        return next;
      });
    }

    // --- Grading messages ---
    else if (msg.type === "grading_started") {
      setGrading((prev) => {
        const next = new Map(prev);
        next.set(msg.sessionId, {
          sessionId: msg.sessionId,
          current: 0,
          total: 0,
          status: "started",
        });
        return next;
      });
    } else if (msg.type === "grading_progress") {
      setGrading((prev) => {
        const next = new Map(prev);
        next.set(msg.sessionId, {
          sessionId: msg.sessionId,
          current: msg.current,
          total: msg.total,
          status: "in_progress",
        });
        return next;
      });
    } else if (msg.type === "grading_complete") {
      setGrading((prev) => {
        const next = new Map(prev);
        const existing = prev.get(msg.sessionId);
        next.set(msg.sessionId, {
          sessionId: msg.sessionId,
          current: existing?.total ?? 0,
          total: existing?.total ?? 0,
          status: "complete",
        });
        return next;
      });
    } else if (msg.type === "grading_failed") {
      setGrading((prev) => {
        const next = new Map(prev);
        next.set(msg.sessionId, {
          sessionId: msg.sessionId,
          current: 0,
          total: 0,
          status: "failed",
          error: msg.error,
        });
        return next;
      });
    }
  }, []);

  // ------------------------------------------
  // Connect
  // ------------------------------------------
  const connect = useCallback(async () => {
    if (!mountedRef.current) return;

    // Get auth token
    const token = await window.__clerk_getToken?.();
    if (!token) {
      setStatus("error");
      return;
    }

    setStatus("connecting");

    const wsUrl = `${getWsUrl()}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setStatus("connected");
      reconnectAttemptRef.current = 0;

      // Re-subscribe to all tracked channels
      for (const sub of pendingSubscriptionsRef.current) {
        const [type, id] = sub.split(":");
        if (type === "exam") {
          send({ type: "subscribe_exam", examId: id! });
        } else if (type === "session") {
          send({ type: "subscribe_session", sessionId: id! });
        }
      }

      // Start ping interval
      pingTimerRef.current = setInterval(() => {
        send({ type: "ping" });
      }, PING_INTERVAL);
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      handleMessage(event.data as string);
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      cleanup();
      setStatus("disconnected");
      scheduleReconnect();
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setStatus("error");
      // onerror is always followed by onclose, reconnect happens there
    };
  }, [send, handleMessage]);

  // ------------------------------------------
  // Cleanup helpers
  // ------------------------------------------
  const cleanup = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current) return;

    const attempt = reconnectAttemptRef.current++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, attempt),
      RECONNECT_MAX_DELAY,
    );

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }, [connect]);

  // ------------------------------------------
  // Subscription methods
  // ------------------------------------------
  const subscribeExam = useCallback(
    (examId: string) => {
      pendingSubscriptionsRef.current.add(`exam:${examId}`);
      send({ type: "subscribe_exam", examId });
    },
    [send],
  );

  const unsubscribeExam = useCallback(
    (examId: string) => {
      pendingSubscriptionsRef.current.delete(`exam:${examId}`);
      send({ type: "unsubscribe_exam", examId });
    },
    [send],
  );

  const subscribeSession = useCallback(
    (sessionId: string) => {
      pendingSubscriptionsRef.current.add(`session:${sessionId}`);
      send({ type: "subscribe_session", sessionId });
    },
    [send],
  );

  const unsubscribeSession = useCallback(
    (sessionId: string) => {
      pendingSubscriptionsRef.current.delete(`session:${sessionId}`);
      send({ type: "unsubscribe_session", sessionId });
    },
    [send],
  );

  // ------------------------------------------
  // Connect on mount, cleanup on unmount
  // ------------------------------------------
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      cleanup();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    generation,
    timers,
    grading,
    subscribeExam,
    unsubscribeExam,
    subscribeSession,
    unsubscribeSession,
    lastMessage,
  };
}
