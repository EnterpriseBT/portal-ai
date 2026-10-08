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
  // #728: only a plain `?token=` string. Express's extended parser turns
  // `token[]=…` / `token[0]=…` into an array that would otherwise stringify
  // into a usable "Bearer <jwt>" while slipping past log redaction.
  const raw = req.query.token;
  const token = typeof raw === "string" ? raw : undefined;
  if (!token) {
    return res.status(401).json({ success: false, message: "Missing token" });
  }

  // Rewrite as Authorization header for standard JWT validation
  req.headers.authorization = `Bearer ${token}`;
  return jwtCheck(req, res, next);
};
