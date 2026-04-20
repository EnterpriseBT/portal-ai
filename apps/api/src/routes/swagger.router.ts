import { Router } from "express";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "../config/swagger.config.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "swagger" });

export const swaggerRouter = Router();

// Serve Swagger UI
swaggerRouter.use("/", swaggerUi.serve);
swaggerRouter.get(
  "/",
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Portal.ai API Documentation",
  })
);

// Serve raw OpenAPI spec as JSON
swaggerRouter.get("/spec", (_req, res) => {
  logger.debug("OpenAPI spec requested");
  res.setHeader("Content-Type", "application/json");
  res.json(swaggerSpec);
});
