import pino from "pino";
import { environment } from "../environment.js";

/**
 * Application logger configuration using Pino.
 *
 * Configuration is controlled via environment variables:
 * - LOG_LEVEL: trace, debug, info, warn, error, fatal (default: info)
 * - LOG_FORMAT: pretty or json (default: pretty)
 *
 * Pretty format: Human-readable, colorized output for development
 * JSON format: Structured logs for production parsing/aggregation
 */
export const logger = pino({
  level: environment.LOG_LEVEL,
  base: {
    service: "portalai-api",
    env: environment.NODE_ENV,
    version: environment.BUILD_SHA,
  },
  transport:
    environment.LOG_FORMAT === "pretty"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss Z",
            ignore: "pid,hostname,service,env,version",
          },
        }
      : undefined,
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  redact: {
    paths: [
      "*.password",
      "*.token",
      "*.accessToken",
      "*.refreshToken",
      "*.idToken",
      "*.id_token",
      "*.apiKey",
      "*.api_key",
      "*.clientSecret",
      "*.client_secret",
      "*.secret",
      "*.authorization",
    ],
    censor: "[REDACTED]",
  },
});

/**
 * Create a child logger with additional context
 * @param context - Additional context to include in all log messages
 * @returns Child logger instance
 *
 * @example
 * const routeLogger = createLogger({ module: 'auth' });
 * routeLogger.info('User logged in');
 */
export const createLogger = (context: Record<string, unknown>) => {
  return logger.child(context);
};
