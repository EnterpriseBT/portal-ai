import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.router.js";
import { protectedRouter } from "./routes/protected.router.js";
import { environment } from "./environment.js";
import { httpLogger } from "./middleware/logger.middleware.js";

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
app.use("/api", protectedRouter);
