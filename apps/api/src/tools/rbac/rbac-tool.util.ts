import { ApiError } from "../../services/http.service.js";

/**
 * Shared helpers for the `rbac_management` toolpack (#629 slice 3) — the
 * agent-facing companion to the RBAC admin UI (`AccessAuthoring` + `ShareDialog`).
 * Each tool is a thin wrapper: validate → call the matching RBAC service with the
 * caller's `PermissionContext` → return the view. The services **self-gate**
 * (entitlement + `member.role.assign` capability + statement boundary), so the
 * tools carry no permission check of their own (per #629 spec decision 4).
 */

/**
 * Audit context stamped on every agent-initiated RBAC mutation. There is no HTTP
 * request behind a tool call, so `sourceIp` is null and `userAgent` marks the
 * change as agent-initiated — the audit trail then distinguishes an RBAC edit the
 * agent made on the user's behalf from one made in the UI.
 */
export const AGENT_AUDIT = {
  sourceIp: null,
  userAgent: "portal-agent",
} as const;

/**
 * Run an RBAC service call for a tool. A **403** (the service's own permission
 * gate — insufficient capability, missing entitlement, or a boundary violation)
 * is **re-thrown** so the per-caller tool-authorization gate
 * (`wrapWithPermissionGate`) converts it to the typed `TOOL_PERMISSION_DENIED`
 * refusal the agent relays. Any other failure (404 not-found, 409 conflict,
 * invalid input) is returned as a relayable `{ error }` tool result instead of a
 * throw, so the agent can explain it without crashing the turn.
 */
export async function runRbac<T>(
  fn: () => Promise<T>
): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) throw err;
    return {
      error: err instanceof Error ? err.message : "RBAC operation failed",
    };
  }
}
