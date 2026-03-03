import { Effect, Logger, LogLevel, Layer } from "effect";
import { env } from "#/lib/env";

// ============================================
// Effect-based Logging
// ============================================
// Provides:
// 1. Plain functions (log.info, log.error, etc.) for use in non-Effect code
//    (worker callbacks, raw route handlers) during the transition.
// 2. An Effect LogLayer for use in Effect pipelines (Phases 3-5).

// --- Log level mapping ---

const LOG_LEVEL_MAP: Record<string, LogLevel.LogLevel> = {
  debug: LogLevel.Debug,
  info: LogLevel.Info,
  warn: LogLevel.Warning,
  error: LogLevel.Error,
  fatal: LogLevel.Fatal,
  none: LogLevel.None,
};

function getLogLevel(): LogLevel.LogLevel {
  const config = env();
  return LOG_LEVEL_MAP[config.server.logLevel] ?? LogLevel.Info;
}

// ============================================
// Effect Logger Layer
// ============================================
// Use this in Effect runtime for structured logging.
// In production: JSON. In dev: human-readable.

const isProduction = () => env().server.nodeEnv === "production";

const jsonLogger = Logger.json;
const prettyLogger = Logger.pretty;

export const LogLayer = Layer.merge(
  isProduction() ? jsonLogger : prettyLogger,
  Logger.minimumLogLevel(getLogLevel()),
);

// ============================================
// Plain logging functions for non-Effect code
// ============================================
// API matches Pino's `logger.info(context, message)` pattern
// so existing call sites need minimal changes.

type LogContext = Record<string, unknown>;

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ?? err.message;
  }
  return String(err);
}

function formatLog(
  level: string,
  component: string,
  messageOrCtx: string | LogContext,
  maybeMessage?: string,
): string {
  const timestamp = new Date().toISOString();

  let message: string;
  let context: LogContext = {};

  if (typeof messageOrCtx === "string") {
    message = messageOrCtx;
  } else {
    context = { ...messageOrCtx };
    message = maybeMessage ?? "";
    // Format error objects for readability
    if (context.err) {
      context.err = formatError(context.err);
    }
  }

  if (isProduction()) {
    return JSON.stringify({ timestamp, level, component, message, ...context });
  }

  const contextStr =
    Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : "";
  return `${timestamp.slice(11, 19)} [${level.toUpperCase()}] [${component}] ${message}${contextStr}`;
}

function createLogger(component: string) {
  return {
    debug(messageOrCtx: string | LogContext, maybeMessage?: string) {
      const level = getLogLevel();
      if (LogLevel.greaterThan(level, LogLevel.Debug)) return;
      console.debug(formatLog("debug", component, messageOrCtx, maybeMessage));
    },
    info(messageOrCtx: string | LogContext, maybeMessage?: string) {
      const level = getLogLevel();
      if (LogLevel.greaterThan(level, LogLevel.Info)) return;
      console.info(formatLog("info", component, messageOrCtx, maybeMessage));
    },
    warn(messageOrCtx: string | LogContext, maybeMessage?: string) {
      const level = getLogLevel();
      if (LogLevel.greaterThan(level, LogLevel.Warning)) return;
      console.warn(formatLog("warn", component, messageOrCtx, maybeMessage));
    },
    error(messageOrCtx: string | LogContext, maybeMessage?: string) {
      console.error(formatLog("error", component, messageOrCtx, maybeMessage));
    },
  };
}

// ============================================
// Pre-built component loggers
// ============================================
// Drop-in replacements for the old Pino child loggers.

export const logger = createLogger("app");
export const apiLogger = createLogger("api");
export const workerLogger = createLogger("worker");
export const authLogger = createLogger("auth");
export const chatLogger = createLogger("chat");
export const dbLogger = createLogger("db");
