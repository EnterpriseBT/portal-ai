import type { AttachmentAuditContext } from "../../services/station-attachment.service.js";
import type { PermissionContext } from "../../services/permission.service.js";

/** #1036: the portal session a station-attachment tool runs in. */
export interface ViewToolSession {
  /** The session's own station: the default target, and the one whose
   *  cached view set an attach or detach must drop. */
  stationId: string;
  portalId: string | null;
}

/**
 * #1036: the audit context for an agent-made attachment change: the caller,
 * the agent's user agent, and the portal session it was made in.
 */
export function viewAttachmentAudit(
  ctx: PermissionContext,
  agent: { sourceIp: null; userAgent: string },
  session: ViewToolSession
): AttachmentAuditContext {
  return {
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    sourceIp: agent.sourceIp,
    userAgent: agent.userAgent,
    sourcePortalId: session.portalId,
  };
}
