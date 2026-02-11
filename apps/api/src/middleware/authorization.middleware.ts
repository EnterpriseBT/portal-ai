import type { Request, Response, NextFunction } from "express";

interface AuthPayload {
  sub: string;
  permissions?: string[];
  scope?: string;
  [key: string]: unknown;
}

/**
 * Middleware factory that checks if the JWT contains the required scope(s).
 * Scopes are space-delimited in the `scope` claim of the JWT.
 *
 * Usage: router.get('/data', jwtCheck, requireScope('read:data'), handler)
 */
export const requireScope = (...requiredScopes: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const payload = req.auth?.payload as AuthPayload | undefined;

    if (!payload?.scope) {
      res.status(403).json({ error: "Insufficient scope" });
      return;
    }

    const tokenScopes = payload.scope.split(" ");
    const hasAll = requiredScopes.every((s) => tokenScopes.includes(s));

    if (!hasAll) {
      res.status(403).json({
        error: "Insufficient scope",
        required: requiredScopes,
        granted: tokenScopes,
      });
      return;
    }

    next();
  };
};

/**
 * Middleware factory that checks if the JWT contains the required permission(s).
 * Permissions are set via Auth0's RBAC and appear in the `permissions` claim.
 *
 * Usage: router.delete('/users/:id', jwtCheck, requirePermission('delete:users'), handler)
 */
export const requirePermission = (...requiredPermissions: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const payload = req.auth?.payload as AuthPayload | undefined;
    const permissions = payload?.permissions || [];

    const hasAll = requiredPermissions.every((p) => permissions.includes(p));

    if (!hasAll) {
      res.status(403).json({
        error: "Insufficient permissions",
        required: requiredPermissions,
      });
      return;
    }

    next();
  };
};
