import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.router.js";
import { protectedRouter } from "./routes/protected.router.js";
import { swaggerRouter } from "./routes/swagger.router.js";
import { environment } from "./environment.js";
import { httpLogger } from "./middleware/logger.middleware.js";
import { ApiError, HttpService } from "./services/http.service.js";
import { createLogger } from "./utils/logger.util.js";

const logger = createLogger({ module: "app" });

export const app = express();

// HTTP request/response logging - logs all incoming requests
app.use(httpLogger);

app.use(express.json());
app.use(
  cors({
    origin: environment.CORS_ORIGIN,
  })
);

app.use("/health", healthRouter);
app.use("/docs", swaggerRouter);
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
