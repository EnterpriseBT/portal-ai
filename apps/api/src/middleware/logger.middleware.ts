import { randomUUID } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import type { Request } from "express";
import type pino from "pino";
import pinoHttpModule from "pino-http";
import { logger } from "../utils/logger.util.js";

// Use default export from pino-http
const pinoHttp = pinoHttpModule.default || pinoHttpModule;

const REQUEST_ID_HEADER = "x-request-id";
const CORRELATION_ID_HEADER = "x-correlation-id";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

/**
 * HTTP request/response logging middleware using pino-http.
 *
 * Each request is assigned a request ID (reused from inbound
 * `x-request-id` or `x-correlation-id` headers when present, otherwise
 * a fresh UUID). The ID is echoed back as `x-request-id` on the response
 * and attached to every log line via `reqId` so logs from a single request
 * can be grouped in CloudWatch Logs Insights.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req: IncomingMessage, res: ServerResponse): string => {
    const inbound =
      req.headers[REQUEST_ID_HEADER] ?? req.headers[CORRELATION_ID_HEADER];
    const headerValue = Array.isArray(inbound) ? inbound[0] : inbound;
    const id = isNonEmptyString(headerValue) ? headerValue : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, id);
    return id;
  },
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
  customProps: (req: IncomingMessage, _res: ServerResponse): object => {
    const expressReq = req as Request;
    return {
      userId: expressReq.auth?.payload?.sub,
    };
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["proxy-authorization"]',
      'req.headers["x-api-key"]',
      'res.headers["set-cookie"]',
      "req.body.password",
      "req.body.token",
      "req.body.accessToken",
      "req.body.refreshToken",
      "req.body.idToken",
      "req.body.id_token",
      "req.body.apiKey",
      "req.body.api_key",
      "req.body.clientSecret",
      "req.body.client_secret",
      "req.body.secret",
    ],
    censor: "[REDACTED]",
  },
});
