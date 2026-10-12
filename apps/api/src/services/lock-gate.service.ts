import type { ToolAuthorization, ToolLock } from "@portalai/core/models";

import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { JobLockService, type LockTarget } from "./job-lock.service.js";
import type { GateableTool } from "./cost-gate.service.js";

/**
 * #769: the job lock for agent write tools. A tool's `TOOL_AUTHORIZATION`
 * entry declares `lock`:
 *  - `target`: the gate resolves each item to a `LockTarget` and runs the
 *    tool inside `JobLockService.withUnlocked`, so the shared scope locks are
 *    held for the whole call (a job can't start over them mid-call);
 *  - `enqueues`: the tool starts a scoped job through `enqueueExclusive`,
 *    which refuses it itself.
 * Either way a lock refusal comes back as a typed `ENTITY_LOCKED_BY_JOB`
 * result naming the running job, never a throw, so the agent relays it.
 *
 * Applied inside the permission gate (an unauthorized caller never learns a
 * job is running) and inside the cost gate (a write tool is free or charges
 * on job success, so a refusal is never charged).
 *
 * The held lock uses one pooled connection for the length of the call, on
 * top of whatever the tool uses; agent calls are low-concurrency.
 */

/** The typed result a refused tool call returns. */
export function lockRefusal(err: ApiError): {
  error: { code: ApiCode; message: string; runningJobs: unknown };
} {
  return {
    error: {
      code: ApiCode.ENTITY_LOCKED_BY_JOB,
      message: err.message,
      runningJobs:
        (err.details as { runningJobs?: unknown } | undefined)?.runningJobs ??
        [],
    },
  };
}

const isLockRefusal = (err: unknown): err is ApiError =>
  err instanceof ApiError && err.code === ApiCode.ENTITY_LOCKED_BY_JOB;

function itemIds(input: unknown, itemsArg: string, idField: string): string[] {
  if (typeof input !== "object" || input === null) return [];
  const items = (input as Record<string, unknown>)[itemsArg];
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    const v =
      typeof item === "object" && item !== null
        ? (item as Record<string, unknown>)[idField]
        : undefined;
    return typeof v === "string" && v.length > 0 ? [v] : [];
  });
}

/** Each item's lock target; ids that resolve to nothing are left to the
 *  tool's own not-found handling. */
async function targetsFor(
  lock: Extract<ToolLock, { target: unknown }>,
  input: unknown,
  organizationId: string
): Promise<LockTarget[]> {
  let ids = [...new Set(itemIds(input, lock.itemsArg, lock.idField))];
  if (lock.resolve === "fieldMappingEntity") {
    const mappings = await Promise.all(
      ids.map((id) => DbService.repository.fieldMappings.findById(id))
    );
    ids = [
      ...new Set(
        mappings.flatMap((m) =>
          m && m.organizationId === organizationId ? [m.connectorEntityId] : []
        )
      ),
    ];
  }
  return ids.map((id): LockTarget => {
    switch (lock.target) {
      case "record":
      case "fieldMapping":
        return { kind: lock.target, connectorEntityId: id };
      default:
        return { kind: lock.target, id };
    }
  });
}

export function wrapWithLockGate(
  tools: Record<string, GateableTool>,
  ctx: { organizationId: string },
  authFor: (toolName: string) => ToolAuthorization | undefined
): void {
  for (const [name, tool] of Object.entries(tools)) {
    const original = tool.execute;
    const lock = authFor(name)?.lock;
    if (!original || !lock) continue;

    tool.execute = async (input: unknown, options: unknown) => {
      try {
        if ("enqueues" in lock) return await original(input, options);
        const targets = await targetsFor(lock, input, ctx.organizationId);
        if (targets.length === 0) return await original(input, options);
        return await JobLockService.withUnlocked(targets, ctx, async () =>
          original(input, options)
        );
      } catch (err) {
        if (isLockRefusal(err)) return lockRefusal(err);
        throw err;
      }
    };
  }
}
