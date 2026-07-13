import { Router } from "express";
import { jwtCheck } from "../middleware/auth.middleware.js";
import { profileRouter } from "./profile.router.js";
import { organizationRouter } from "./organization.router.js";
import { connectorDefinitionRouter } from "./connector-definition.router.js";
import { connectorInstanceRouter } from "./connector-instance.router.js";
import { jobsRouter } from "./jobs.router.js";
import { columnDefinitionRouter } from "./column-definition.router.js";
import { connectorEntityRouter } from "./connector-entity.router.js";
import { fieldMappingRouter } from "./field-mapping.router.js";
import { fileUploadsRouter } from "./file-uploads.router.js";
import { entityTagRouter } from "./entity-tag.router.js";
import { entityGroupRouter } from "./entity-group.router.js";
import { stationRouter } from "./station.router.js";
import { portalRouter } from "./portal.router.js";
import { portalResultsRouter } from "./portal-results.router.js";
import { toolpacksRouter } from "./toolpacks.router.js";
import { connectorInstanceLayoutPlansRouter } from "./connector-instance-layout-plans.router.js";
import { apiEndpointsRouter } from "./api-endpoints.router.js";
import { layoutPlansRouter } from "./layout-plans.router.js";
import { googleSheetsConnectorRouter } from "./google-sheets-connector.router.js";
import { microsoftExcelConnectorRouter } from "./microsoft-excel-connector.router.js";
import { adminRouter } from "./admin.router.js";
import { portalSqlHandleRouter } from "./portal-sql-handle.router.js";

export const protectedRouter = Router();

// All routes in this router require a valid JWT
protectedRouter.use(jwtCheck);

// Mount routers
protectedRouter.use("/profile", profileRouter);
protectedRouter.use("/organization", organizationRouter);
protectedRouter.use("/connector-definitions", connectorDefinitionRouter);
protectedRouter.use("/connector-instances", connectorInstanceRouter);
protectedRouter.use("/connector-instances", connectorInstanceLayoutPlansRouter);
protectedRouter.use(
  "/connector-instances/:instanceId/api-endpoints",
  apiEndpointsRouter
);
protectedRouter.use("/layout-plans", layoutPlansRouter);
protectedRouter.use("/jobs", jobsRouter);
protectedRouter.use("/column-definitions", columnDefinitionRouter);
protectedRouter.use("/connector-entities", connectorEntityRouter);
protectedRouter.use("/field-mappings", fieldMappingRouter);
protectedRouter.use("/file-uploads", fileUploadsRouter);
protectedRouter.use("/entity-tags", entityTagRouter);
protectedRouter.use("/entity-groups", entityGroupRouter);
protectedRouter.use("/stations", stationRouter);
protectedRouter.use("/portals", portalRouter);
protectedRouter.use("/portal-results", portalResultsRouter);
protectedRouter.use("/portal-sql", portalSqlHandleRouter);
protectedRouter.use("/toolpacks", toolpacksRouter);
protectedRouter.use("/connectors/google-sheets", googleSheetsConnectorRouter);
protectedRouter.use(
  "/connectors/microsoft-excel",
  microsoftExcelConnectorRouter
);
protectedRouter.use("/admin", adminRouter);
