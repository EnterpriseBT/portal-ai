import type { ObjectCapabilities } from "@portalai/core/contracts";
import type { ActionGate } from "@portalai/core/ui";

import { decideActionGate } from "./action-gate.util";

export const SYSTEM_READONLY_REASON = "System column definitions are read-only";

/**
 * #689: a column definition's Edit/Delete. The routes check the row's
 * write/delete, then refuse system rows (`COLUMN_DEFINITION_SYSTEM_READONLY`)
 * whatever the caller holds. Edit on a system row stays visible, disabled
 * with the reason; Delete there can never succeed, so it's hidden.
 */
export function columnDefinitionActionGates({
  capabilities,
  system,
  lockedReason = null,
}: {
  capabilities: ObjectCapabilities;
  system: boolean;
  /** #769: a running job holds an entity that maps it (`jobLockReason`). */
  lockedReason?: string | null;
}): { edit: ActionGate; delete: ActionGate } {
  return {
    edit: decideActionGate({
      allowed: capabilities.write,
      // A system row can never be edited; that reason outlasts any job.
      blocked: system ? SYSTEM_READONLY_REASON : lockedReason,
    }),
    delete: decideActionGate({
      allowed: capabilities.delete && !system,
      blocked: lockedReason,
    }),
  };
}
