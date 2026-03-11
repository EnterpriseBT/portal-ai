import { Router } from "express";
import { jwtCheck } from "../middleware/auth.middleware.js";
import { profileRouter } from "./profile.router.js";
import { organizationRouter } from "./organization.router.js";
import { connectorDefinitionRouter } from "./connector-definition.router.js";

export const protectedRouter = Router();

// All routes in this router require a valid JWT
protectedRouter.use(jwtCheck);

// Mount routers
protectedRouter.use("/profile", profileRouter);
protectedRouter.use("/organization", organizationRouter);
protectedRouter.use("/connector-definitions", connectorDefinitionRouter);
