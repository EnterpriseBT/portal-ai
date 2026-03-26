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
import { uploadsRouter } from "./uploads.router.js";
import { entityTagRouter } from "./entity-tag.router.js";
import { entityGroupRouter } from "./entity-group.router.js";
import { stationRouter } from "./station.router.js";
import { portalRouter } from "./portal.router.js";
import { portalResultsRouter } from "./portal-results.router.js";
import { organizationToolsRouter } from "./organization-tools.router.js";
import { stationToolsRouter } from "./station-tools.router.js";

export const protectedRouter = Router();

// All routes in this router require a valid JWT
protectedRouter.use(jwtCheck);

// Mount routers
protectedRouter.use("/profile", profileRouter);
protectedRouter.use("/organization", organizationRouter);
protectedRouter.use("/connector-definitions", connectorDefinitionRouter);
protectedRouter.use("/connector-instances", connectorInstanceRouter);
protectedRouter.use("/jobs", jobsRouter);
protectedRouter.use("/column-definitions", columnDefinitionRouter);
protectedRouter.use("/connector-entities", connectorEntityRouter);
protectedRouter.use("/field-mappings", fieldMappingRouter);
protectedRouter.use("/uploads", uploadsRouter);
protectedRouter.use("/entity-tags", entityTagRouter);
protectedRouter.use("/entity-groups", entityGroupRouter);
protectedRouter.use("/stations", stationRouter);
protectedRouter.use("/stations", stationToolsRouter);
protectedRouter.use("/portals", portalRouter);
protectedRouter.use("/portal-results", portalResultsRouter);
protectedRouter.use("/organization-tools", organizationToolsRouter);
