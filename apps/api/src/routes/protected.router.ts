import { Router } from "express";
import { jwtCheck } from "../middleware/auth.middleware.js";
import { profileRouter } from "./profile.router.js";

export const protectedRouter = Router();

// All routes in this router require a valid JWT
protectedRouter.use(jwtCheck);

// Mount profile router
protectedRouter.use("/profile", profileRouter);
