import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { ApiCode } from "./constants/api-codes.constants.js";
import { healthRouter } from "./routes/health.router.js";
import { protectedRouter } from "./routes/protected.router.js";
import { sseRouter } from "./routes/sse.router.js";
import { webhookRouter } from "./routes/webhook.router.js";
import { swaggerRouter } from "./routes/swagger.router.js";
import { environment } from "./environment.js";
import { httpLogger } from "./middleware/logger.middleware.js";
import { requestContextMiddleware } from "./middleware/request-context.middleware.js";
import { ApiError, HttpService } from "./services/http.service.js";
import { createLogger } from "./utils/logger.util.js";

import { registerAdapters } from "./adapters/register.js";

const logger = createLogger({ module: "app" });

export const app = express();

// Register all connector adapters
registerAdapters();

// HTTP request/response logging - logs all incoming requests
app.use(httpLogger);

// Propagate req.log into AsyncLocalStorage so service-layer loggers
// inherit reqId/userId without needing to pass req through every call.
app.use(requestContextMiddleware);

// Webhook routes must be mounted before express.json() so the webhook's
// custom JSON parser can capture the raw body for HMAC signature verification.
app.use("/api/webhooks", webhookRouter);

app.use(express.json({ limit: environment.REQUEST_JSON_LIMIT_BYTES }));
app.use(
  cors({
    origin: environment.CORS_ORIGIN,
  })
);

app.use("/api/docs", swaggerRouter);
app.use("/api/health", healthRouter);
// SSE routes use query-param auth (sseAuth) — mount before protectedRouter
// so the router-level jwtCheck does not reject the headerless EventSource request.
app.use("/api/sse", sseRouter);
app.use("/api", protectedRouter);

// Catch-all error handler — all ApiErrors passed to next() are handled here
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const log = req.log ?? logger;

  if (err instanceof ApiError) {
    log.error(
      { code: err.code, status: err.status, message: err.message },
      "ApiError caught by error handler"
    );
    return HttpService.error(res, err);
  }

  // Body-parser surfaces structured errors with `type` / `status` set by
  // raw-body. Map them to first-class ApiErrors instead of letting them fall
  // through as a generic 500 — most importantly so an oversized JSON body
  // returns 413 with a code the client can react to.
  const bodyParserErr = err as Error & {
    type?: string;
    status?: number;
  };
  if (bodyParserErr.type === "entity.too.large") {
    log.warn(
      { limitBytes: environment.REQUEST_JSON_LIMIT_BYTES, route: req.originalUrl },
      "JSON body exceeded size limit"
    );
    return HttpService.error(
      res,
      new ApiError(
        413,
        ApiCode.REQUEST_PAYLOAD_TOO_LARGE,
        `Request body exceeds ${environment.REQUEST_JSON_LIMIT_BYTES} bytes`
      )
    );
  }
  if (
    bodyParserErr.type === "entity.parse.failed" ||
    bodyParserErr.type === "encoding.unsupported" ||
    bodyParserErr.type === "charset.unsupported"
  ) {
    log.warn(
      { route: req.originalUrl, type: bodyParserErr.type },
      "Malformed JSON body"
    );
    return HttpService.error(
      res,
      new ApiError(
        400,
        ApiCode.REQUEST_BODY_INVALID_JSON,
        bodyParserErr.message
      )
    );
  }

  log.error({ err }, "Unhandled error caught by error handler");
  return res.status(500).json({
    success: false,
    message: "Internal server error",
    code: "UNKNOWN",
  });
});
