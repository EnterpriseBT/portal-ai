import { Router } from "express";
import { jwtCheck } from "../middleware/auth.middleware.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "protected" });

export const protectedRouter = Router();

// All routes in this router require a valid JWT
protectedRouter.use(jwtCheck);

/**
 * GET /api/me
 * Returns the authenticated user's token claims.
 */
protectedRouter.get("/me", (req, res) => {
  if (!req.auth?.payload) {
    logger.warn("Unauthorized access attempt to /me endpoint");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const payload = req.auth.payload;
  logger.info(
    { userId: payload.sub },
    "User retrieved their profile information"
  );

  res.json({
    sub: payload.sub,
    scope: payload.scope,
    permissions: payload.permissions,
  });
});

// --- Example: scope-protected route ---
// protectedRouter.get("/data", requireScope("read:data"), (req, res) => {
//   res.json({ data: "This requires read:data scope" });
// });

// --- Example: permission-protected route (RBAC) ---
// protectedRouter.delete(
//   "/admin/users/:id",
//   requirePermission("delete:users"),
//   (req, res) => {
//     res.json({ message: `User ${req.params.id} deleted` });
//   }
// );
