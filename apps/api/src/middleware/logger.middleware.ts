import type { IncomingMessage, ServerResponse } from "http";
import type { Request } from "express";
import type pino from "pino";
import pinoHttpModule from "pino-http";
import { logger } from "../utils/logger.util.js";

// Use default export from pino-http
const pinoHttp = pinoHttpModule.default || pinoHttpModule;

/**
 * HTTP request/response logging middleware using pino-http.
 *
 * Automatically logs:
 * - Request method, URL, and headers
 * - Response status code and duration
 * - User authentication info (if available)
 * - Request/response body (configurable)
 *
 * Logs are structured JSON in production, pretty-printed in development.
 */
export const httpLogger = pinoHttp({
  logger,
  // Customize log message format
  customLogLevel: (
    _req: IncomingMessage,
    res: ServerResponse,
    err?: Error,
  ): pino.LevelWithSilent => {
    if (res.statusCode >= 500 || err) {
      return "error";
    }
    if (res.statusCode >= 400) {
      return "warn";
    }
    if (res.statusCode >= 300) {
      return "info";
    }
    return "info";
  },
  // Add custom properties to each log entry
  customSuccessMessage: (
    req: IncomingMessage,
    res: ServerResponse,
  ): string => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage: (
    req: IncomingMessage,
    res: ServerResponse,
    err: Error,
  ): string => {
    return `${req.method} ${req.url} ${res.statusCode} - ${err.message}`;
  },
  // Customize what gets logged
  customProps: (req: IncomingMessage, _res: ServerResponse): object => {
    // Cast to Express Request to access auth property
    const expressReq = req as Request;
    return {
      // Add user ID if authenticated
      userId: expressReq.auth?.payload?.sub,
      // Add correlation ID for request tracking (if available)
      correlationId: req.headers["x-correlation-id"],
    };
  },
  // Redact sensitive information (pino-http uses pino's redact feature)
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.body.password",
    "req.body.token",
  ],
});
