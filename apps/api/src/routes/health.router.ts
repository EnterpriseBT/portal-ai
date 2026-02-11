import { Router } from "express";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "health" });

export const healthRouter = Router();

healthRouter.get("/", (_req, res) => {
  logger.debug("Health check requested");
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
