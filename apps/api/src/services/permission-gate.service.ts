import type { ToolAuthorization } from "@portalai/core/models";

import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { RbacObjectResolver } from "./rbac-object-resolver.js";
import type { PermissionSet } from "./permission-set.js";
import type {
  PermissionAction,
  PermissionObject,
} from "./permission.service.js";
import type { GateableTool } from "./cost-gate.service.js";

/**
 * Per-caller, per-object tool-authorization gate (#629). The agent is a direct
 * extension of the user: it may do exactly what the user's roles, grants, and
 * group memberships permit, and any disallowed write **surfaces** to the user
 * rather than crashing the turn.
 *
 * `wrapWithPermissionGate` decorates every tool's `execute` in place (mirroring
 * `wrapWithCostGate`, applied *outside* it so a denied call never reaches cost
 * admission). Two paths converge on the same typed refusal:
 *
 *  - **pre-flight** for descriptor-carrying tools — `create` checks
 *    `resource.write` on the type; `single`/`delete` resolves the target's
 *    `createdBy` (via {@link RbacObjectResolver}) and checks per object. `bulk`
 *    tools are NOT pre-flighted — they self-scope by AND-ing
 *    `visibilityPredicate` into their write `WHERE` (one DB statement, never N
 *    checks).
 *  - **catch** — any `ApiError(403)` thrown inside `execute` (e.g. an
 *    `rbac_management` tool's own service gate) is converted to the same
 *    refusal.
 *
 * Fail-**closed**: a resolution error (unlike the cost gate's fail-open) denies.
 * The check is O(1) per invocation — the caller's `PermissionSet` is resolved
 * once per session and every `can` is a pure in-memory evaluation.
 */

/** A typed refusal returned *as a tool result* (never a throw), so the agent
 *  relays it. Mirrors the cost gate's `Denial.result` shape. */
export function permissionDenied(message: string): {
  error: { code: ApiCode; message: string };
} {
  return { error: { code: ApiCode.TOOL_PERMISSION_DENIED, message } };
}

function extractId(input: unknown, key?: string): string | undefined {
  if (!key || typeof input !== "object" || input === null) return undefined;
  const v = (input as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function wrapWithPermissionGate(
  tools: Record<string, GateableTool>,
  permissionSet: PermissionSet,
  ctx: { organizationId: string; userId: string },
  authFor: (toolName: string) => ToolAuthorization | undefined
): void {
  for (const [name, tool] of Object.entries(tools)) {
    const original = tool.execute;
    if (!original) continue;
    const auth = authFor(name);

    tool.execute = async (input: unknown, options: unknown) => {
      // Pre-flight: create/single carry a descriptor the gate checks per object.
      // bulk (and undescribed tools) skip pre-flight — bulk self-scopes via the
      // visibility predicate; undescribed writes rely on their service (the
      // catch below surfaces its 403).
      if (auth && (auth.mode === "create" || auth.mode === "single")) {
        const action = `resource.${auth.verb}` as PermissionAction;
        let allowed = false;
        try {
          if (auth.mode === "create") {
            allowed = permissionSet.can(action, {
              type: auth.resourceType,
            } as PermissionObject);
          } else {
            const id = extractId(input, auth.targetIdArg);
            if (id) {
              const createdBy = await RbacObjectResolver.resolveCreatedBy(
                ctx.organizationId,
                auth.resourceType,
                id
              );
              // A target we can't resolve (absent / cross-org) is denied.
              allowed =
                createdBy !== null &&
                permissionSet.can(action, {
                  type: auth.resourceType,
                  id,
                  createdBy,
                } as PermissionObject);
            }
          }
        } catch {
          allowed = false; // fail-closed
        }
        if (!allowed) {
          return permissionDenied(
            `You do not have permission to ${auth.verb} this ${auth.resourceType}.`
          );
        }
      }

      // Run the tool; a service-thrown 403 (e.g. an rbac_management tool's gate)
      // surfaces as the same typed refusal instead of an uncaught crash.
      try {
        return await original(input, options);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          return permissionDenied(err.message);
        }
        throw err;
      }
    };
  }
}
