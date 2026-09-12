import type { Request } from "express";

/**
 * The common audit fields carried on an authenticated request (#575): the
 * actor + org from `req.application.metadata`, and the request context
 * (`sourceIp`, `userAgent`) for the audit row. `req.ip` is the real client IP
 * only when `trust proxy` is configured for the deployment (see app.ts);
 * otherwise it is the socket peer, which is still a truthful value locally.
 */
export interface AuditRequestContext {
  userId: string;
  organizationId: string;
  sourceIp: string | null;
  userAgent: string | null;
}

export function auditContextFromRequest(req: Request): AuditRequestContext {
  return {
    userId: req.application?.metadata.userId as string,
    organizationId: req.application?.metadata.organizationId as string,
    sourceIp: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}
