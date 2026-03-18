import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.router.js";
import { protectedRouter } from "./routes/protected.router.js";
import { sseRouter } from "./routes/sse.router.js";
import { webhookRouter } from "./routes/webhook.router.js";
import { swaggerRouter } from "./routes/swagger.router.js";
import { environment } from "./environment.js";
import { httpLogger } from "./middleware/logger.middleware.js";
import { ApiError, HttpService } from "./services/http.service.js";
import { createLogger } from "./utils/logger.util.js";

import { registerAdapters } from "./adapters/register.js";

const logger = createLogger({ module: "app" });

export const app = express();

// Register all connector adapters
registerAdapters();

// HTTP request/response logging - logs all incoming requests
app.use(httpLogger);

// Webhook routes must be mounted before express.json() so the webhook's
// custom JSON parser can capture the raw body for HMAC signature verification.
app.use("/api/webhooks", webhookRouter);

app.use(express.json());
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
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    logger.error(
      { code: err.code, status: err.status, message: err.message },
      "ApiError caught by error handler"
    );
    return HttpService.error(res, err);
  }

  logger.error(
    { error: err.message, stack: err.stack },
    "Unhandled error caught by error handler"
  );
  return res.status(500).json({
    success: false,
    message: "Internal server error",
    code: "UNKNOWN",
  });
});
