import { ApiError } from "./http.service.js";
import { PortalSqlHandleService } from "./portal-sql-handle.service.js";
import type { GateableTool } from "./cost-gate.service.js";

/** A query handle's id: `qh-` and a UUID (`produce` mints `qh-${randomUUID()}`). */
const HANDLE_ID =
  /^qh-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bound on how deep the input walk goes; tool input is shallow JSON. */
const MAX_DEPTH = 8;

/**
 * Every query-handle id a tool call's input names, under any key and at any
 * depth (`queryHandle`, `benchmarkQueryHandle`, a custom tool's own field).
 * Matching the id's shape, not a key name, is what keeps a new tool or a
 * custom one from slipping past.
 */
export function findHandleIds(input: unknown): string[] {
  const found = new Set<string>();
  const walk = (value: unknown, depth: number) => {
    if (depth > MAX_DEPTH) return;
    if (typeof value === "string") {
      if (HANDLE_ID.test(value)) found.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    if (value != null && typeof value === "object") {
      for (const item of Object.values(value)) walk(item, depth + 1);
    }
  };
  walk(input, 0);
  return [...found];
}

type Caller = { organizationId: string; userId: string };

/**
 * #1038 (adversarial A): refuse a tool call that names a query handle the
 * caller may not read, before the tool runs. Tools read a handle's rows by
 * id (`resolveRecordSource`, `streamHandle`, a webhook's pull grant) with no
 * check of their own, so a member whose view was revoked could still feed
 * their live handle (its id is in their history) to a compute tool, and a
 * caller holding another user's or org's handle id could read it. The check
 * is `PortalSqlHandleService.authorizeToolRead`: the handle route's rules.
 *
 * Every tool is gated, custom ones included (their runtime pulls the rows
 * through a read grant). A refusal is the typed expired-handle result, the
 * same answer the route gives, so it reveals nothing. Applied outside the
 * cost gate, like every gate that can refuse, so a refusal is never charged.
 */
export function wrapWithHandleAccessGate(
  tools: Record<string, GateableTool>,
  caller: Caller,
  deps: {
    authorize?: (handleId: string, caller: Caller) => Promise<void>;
  } = {}
): void {
  const authorize =
    deps.authorize ??
    ((id: string, c: Caller) =>
      PortalSqlHandleService.authorizeToolRead(id, c));
  for (const tool of Object.values(tools)) {
    const original = tool.execute;
    if (!original) continue;

    tool.execute = async (input: unknown, options: unknown) => {
      for (const handleId of findHandleIds(input)) {
        try {
          await authorize(handleId, caller);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            return { error: { code: err.code, message: err.message } };
          }
          throw err;
        }
      }
      return original(input, options);
    };
  }
}
