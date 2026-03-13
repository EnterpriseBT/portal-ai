import { Request, Response, NextFunction } from "express";
import { jwtCheck } from "./auth.middleware.js";

/**
 * SSE authentication middleware.
 *
 * The browser `EventSource` API does not support custom headers, so the
 * JWT is passed as a `?token=<jwt>` query parameter instead of the usual
 * `Authorization: Bearer <token>` header. This middleware rewrites the
 * query param into the Authorization header and delegates to the standard
 * `jwtCheck` middleware.
 */
export const sseAuth = (req: Request, res: Response, next: NextFunction) => {
  const token = req.query.token as string | undefined;
  if (!token) {
    return res.status(401).json({ success: false, message: "Missing token" });
  }

  // Rewrite as Authorization header for standard JWT validation
  req.headers.authorization = `Bearer ${token}`;
  return jwtCheck(req, res, next);
};
