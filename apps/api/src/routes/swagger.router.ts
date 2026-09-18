import { Router } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "../config/swagger.config.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "swagger" });

export const swaggerRouter = Router();

// Swagger UI is HTML with an inline setup <script> and inline customCss, which
// the strict global CSP (app.ts) would block. Relax the CSP to allow inline
// script/style — scoped to this router only, so the rest of the API keeps the
// strict policy. The API otherwise serves JSON, for which CSP is inert.
swaggerRouter.use(
  helmet.contentSecurityPolicy({
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'"],
      "style-src": ["'self'", "'unsafe-inline'"],
    },
  })
);

// Serve Swagger UI
swaggerRouter.use("/", swaggerUi.serve);
swaggerRouter.get(
  "/",
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Portals AI API Documentation",
  })
);

// Serve raw OpenAPI spec as JSON
swaggerRouter.get("/spec", (_req, res) => {
  logger.debug("OpenAPI spec requested");
  res.setHeader("Content-Type", "application/json");
  res.json(swaggerSpec);
});
