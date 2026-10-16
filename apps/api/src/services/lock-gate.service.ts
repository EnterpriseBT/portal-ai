import { and, eq, inArray } from "drizzle-orm";

import type { ToolAuthorization, ToolLock } from "@portalai/core/models";

import { ApiCode } from "../constants/api-codes.constants.js";
import { fieldMappings } from "../db/schema/index.js";
import { FieldMappingValidationService } from "./field-mapping-validation.service.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import {
  AdmissionGate,
  GateRejectedError,
} from "../utils/admission-gate.util.js";
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
 * job is running) and outside the cost gate (#811), so a refusal is never
 * admitted: it neither charges nor spends a rate-window slot. The held locks
 * therefore also cover the cost gate's admission and commit, a few
 * milliseconds, and only for a charged tool.
 *
 * The held lock uses one pooled connection for the length of the call, on
 * top of whatever the tool uses, and the API's pool is 10 connections shared
 * with the workers. So a `target` call runs through `LOCK_GATE_ADMISSION`:
 * at most 3 at once per process (2 per org), the rest waiting up to 30s; one
 * that can't be admitted is a typed `TOOL_WRITE_BUSY` result.
 */

export const LOCK_GATE_ADMISSION_OPTIONS = {
  concurrency: 3,
  perKeyLimit: 2,
  maxQueue: 50,
  maxWaitMs: 30_000,
};
const LOCK_GATE_ADMISSION = new AdmissionGate(LOCK_GATE_ADMISSION_OPTIONS);

/** The typed result a call the admission gate couldn't seat returns. */
export function writeBusy(): { error: { code: ApiCode; message: string } } {
  return {
    error: {
      code: ApiCode.TOOL_WRITE_BUSY,
      message:
        "Too many changes are running at once. Try the change again in a moment.",
    },
  };
}

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
    // One query for the batch (up to 100 items), org-scoped; a mapping that
    // references another entity also locks that one (a delete clears its
    // counterpart there).
    const mappings =
      ids.length === 0
        ? []
        : await DbService.repository.fieldMappings.findMany(
            and(
              inArray(fieldMappings.id, ids),
              eq(fieldMappings.organizationId, organizationId)
            )
          );
    ids = await FieldMappingValidationService.lockEntityIds(mappings);
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
        const signal = (options as { abortSignal?: AbortSignal } | undefined)
          ?.abortSignal;
        return await LOCK_GATE_ADMISSION.run(ctx.organizationId, signal, () =>
          JobLockService.withUnlocked(targets, ctx, async () =>
            original(input, options)
          )
        );
      } catch (err) {
        if (isLockRefusal(err)) return lockRefusal(err);
        if (err instanceof GateRejectedError) return writeBusy();
        throw err;
      }
    };
  }
}
