import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * Root logger instance.
 * - Production: structured JSON output (machine-readable)
 * - Development: pretty-printed with colors via pino-pretty
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }),
});

/**
 * Pre-built child loggers for major subsystems.
 * Each child logger automatically includes a `component` field
 * in every log line for easy filtering.
 */
export const apiLogger = logger.child({ component: "api" });
export const workerLogger = logger.child({ component: "worker" });
export const authLogger = logger.child({ component: "auth" });
export const chatLogger = logger.child({ component: "chat" });
export const dbLogger = logger.child({ component: "db" });
