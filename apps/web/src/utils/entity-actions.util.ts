import type { ObjectCapabilities } from "@portalai/core/contracts";
import type { ActionGate } from "@portalai/core/ui";

import { decideActionGate } from "./action-gate.util";
import { WRITES_DISABLED_REASON } from "./connector-instance-actions.util";

/** Class-level `entity_record` permissions: the record create, clear and
 *  re-validate routes check the type, not one record. */
export interface RecordPermissions {
  create: boolean;
  write: boolean;
  delete: boolean;
}

export interface EntityDetailActionGateInput {
  /** The entity's `capabilities` from its GET payload. */
  capabilities: ObjectCapabilities;
  recordPermissions: RecordPermissions;
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
 * - Record create / clear: class create / delete + flag + lock.
 * - Re-validate: class write + lock.
 */
export function entityDetailActionGates({
  capabilities,
  recordPermissions,
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
      allowed: recordPermissions.create,
      blocked: firstReason(flag, lockedReason),
    }),
    clearRecords: decideActionGate({
      allowed: recordPermissions.delete,
      blocked: firstReason(
        flag,
        lockedReason,
        isClearingRecords && "Deleting records…"
      ),
    }),
    revalidate: decideActionGate({
      allowed: recordPermissions.write,
      blocked: firstReason(lockedReason, isRevalidating && "Re-validating…"),
    }),
    canEditTags: capabilities.write,
  };
}

export interface EntityRecordActionGateInput {
  /** The record's `capabilities` from its GET payload. */
  capabilities: ObjectCapabilities;
  /** Class-level `entity_record` write: re-validate covers the entity. */
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
 * #689: the record page's gates. Record PATCH/DELETE check the record's
 * write/delete + the write flag + the lock; re-validate (entity-wide) checks
 * the class write + the lock.
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
 * #689: a field-mapping row's Edit/Delete. Both routes check the row's
 * write/delete and the connector's write flag; they also check the entity's
 * job lock, which a list row can't see, so a race there ends in the 409.
 */
export function fieldMappingRowGates({
  capabilities,
  isWriteEnabled,
}: {
  capabilities: ObjectCapabilities;
  isWriteEnabled: boolean;
}): { edit: ActionGate; delete: ActionGate } {
  const blocked = isWriteEnabled ? null : WRITES_DISABLED_REASON;
  return {
    edit: decideActionGate({ allowed: capabilities.write, blocked }),
    delete: decideActionGate({ allowed: capabilities.delete, blocked }),
  };
}
