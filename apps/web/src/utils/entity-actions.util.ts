import type { ObjectCapabilities } from "@portalai/core/contracts";
import type { ActionGate } from "@portalai/core/ui";

import { decideActionGate } from "./action-gate.util";
import { WRITES_DISABLED_REASON } from "./connector-instance-actions.util";

export interface EntityDetailActionGateInput {
  /** The entity's `capabilities` from its GET payload. */
  capabilities: ObjectCapabilities;
  /** The connector instance's `enabledCapabilityFlags.write`. */
  isWriteEnabled: boolean;
  /** The running-job lock reason, or null when unlocked. */
  lockedReason: string | null;
  isUpdating: boolean;
  isDeleting: boolean;
  isClearingRecords: boolean;
  isRevalidating: boolean;
}

export interface EntityDetailActionGates {
  edit: ActionGate;
  delete: ActionGate;
  createRecord: ActionGate;
  clearRecords: ActionGate;
  revalidate: ActionGate;
  /** Tag assign/unassign need entity write, and nothing else. */
  canEditTags: boolean;
}

/** The first transient reason that applies, in order; null when none. */
const firstReason = (...reasons: (string | false | null)[]): string | null =>
  reasons.find((r): r is string => !!r) ?? null;

/**
 * #689: the entity page's gates, each from the checks its route makes:
 * permission (`decideActionGate` hides), then the write flag where the route
 * asserts it, then the job lock, then the action's own pending state.
 *
 * - Entity PATCH: entity write + flag + lock. DELETE: entity delete + lock.
 * - #829: records are parts of the entity, so record create and clear
 *   (entity write + flag + lock) and re-validate (entity write + lock) all
 *   follow the entity's own write.
 */
export function entityDetailActionGates({
  capabilities,
  isWriteEnabled,
  lockedReason,
  isUpdating,
  isDeleting,
  isClearingRecords,
  isRevalidating,
}: EntityDetailActionGateInput): EntityDetailActionGates {
  const flag = !isWriteEnabled && WRITES_DISABLED_REASON;
  return {
    edit: decideActionGate({
      allowed: capabilities.write,
      blocked: firstReason(flag, lockedReason, isUpdating && "Saving…"),
    }),
    delete: decideActionGate({
      allowed: capabilities.delete,
      blocked: firstReason(lockedReason, isDeleting && "Deleting…"),
    }),
    createRecord: decideActionGate({
      allowed: capabilities.write,
      blocked: firstReason(flag, lockedReason),
    }),
    clearRecords: decideActionGate({
      allowed: capabilities.write,
      blocked: firstReason(
        flag,
        lockedReason,
        isClearingRecords && "Deleting records…"
      ),
    }),
    revalidate: decideActionGate({
      allowed: capabilities.write,
      blocked: firstReason(lockedReason, isRevalidating && "Re-validating…"),
    }),
    canEditTags: capabilities.write,
  };
}

export interface EntityRecordActionGateInput {
  /** The record's `capabilities` from its GET payload. */
  capabilities: ObjectCapabilities;
  /** Re-validate covers the whole entity: the entity's write, which a
   *  record's capabilities mirror (#829). */
  canRevalidate: boolean;
  isWriteEnabled: boolean;
  lockedReason: string | null;
  isUpdating: boolean;
  isDeleting: boolean;
  isRevalidating: boolean;
}

export interface EntityRecordActionGates {
  edit: ActionGate;
  delete: ActionGate;
  revalidate: ActionGate;
}

/**
 * #689: the record page's gates. Record PATCH/DELETE check the entity's
 * write (#829: the record's capabilities are its entity's) + the write flag
 * + the lock; re-validate (entity-wide) checks entity write + the lock.
 */
export function entityRecordActionGates({
  capabilities,
  canRevalidate,
  isWriteEnabled,
  lockedReason,
  isUpdating,
  isDeleting,
  isRevalidating,
}: EntityRecordActionGateInput): EntityRecordActionGates {
  const flag = !isWriteEnabled && WRITES_DISABLED_REASON;
  return {
    edit: decideActionGate({
      allowed: capabilities.write,
      blocked: firstReason(flag, lockedReason, isUpdating && "Saving changes…"),
    }),
    delete: decideActionGate({
      allowed: capabilities.delete,
      blocked: firstReason(flag, lockedReason, isDeleting && "Deleting…"),
    }),
    revalidate: decideActionGate({
      allowed: canRevalidate,
      blocked: firstReason(lockedReason, isRevalidating && "Re-validating…"),
    }),
  };
}

/**
 * #689: a field-mapping row's Edit/Delete. Both routes check the entity's
 * write (#829: the row's capabilities are its entity's) and the connector's
 * write flag; they also check the entity's
 * job lock, which a list row can't see, so a race there ends in the 409.
 */
export function fieldMappingRowGates({
  capabilities,
  isWriteEnabled,
  lockedReason = null,
}: {
  capabilities: ObjectCapabilities;
  isWriteEnabled: boolean;
  /** #769: a running job holds the mapping's entity or its connector. */
  lockedReason?: string | null;
}): { edit: ActionGate; delete: ActionGate } {
  const blocked = isWriteEnabled ? lockedReason : WRITES_DISABLED_REASON;
  return {
    edit: decideActionGate({ allowed: capabilities.write, blocked }),
    delete: decideActionGate({ allowed: capabilities.delete, blocked }),
  };
}
