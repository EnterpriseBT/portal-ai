import type { ObjectCapabilities } from "@portalai/core/contracts";
import type { ActionGate } from "@portalai/core/ui";

import { decideActionGate } from "./action-gate.util";

/** The connector's own Write flag is off: state, not permission (#689). */
export const WRITES_DISABLED_REASON = "Writes are disabled on this connector";

export interface ConnectorInstanceActionGateInput {
  /** The instance's `capabilities` from its GET payload. */
  capabilities: ObjectCapabilities;
  /** Class-level `canOnResource("entity", "write")`: entity create is an
   *  owned create under a readable instance, not an instance write. */
  canCreateEntity: boolean;
  /** `enabledCapabilityFlags.write`: the connector-level write switch. */
  isWriteEnabled: boolean;
  /** The running-job lock reason, or null when unlocked. */
  lockedReason: string | null;
}

export interface ConnectorInstanceActionGates {
  edit: ActionGate;
  sync: ActionGate;
  reconnect: ActionGate;
  editLayoutPlan: ActionGate;
  delete: ActionGate;
  createEntity: ActionGate;
  /** Whether the Write/Sync/Push flags render as controls (else read-only). */
  canEditFlags: boolean;
}

/**
 * #689: the connector-instance page's gates, from the same checks its
 * routes enforce — instance `resource.write` for edit/sync/reconnect/plan
 * (and the flags), `resource.delete` for delete, and an owned entity create.
 * The running-job lock blocks everything that writes the instance's data;
 * reconnect only replaces credentials, so the server doesn't lock it.
 */
export function connectorInstanceActionGates({
  capabilities,
  canCreateEntity,
  isWriteEnabled,
  lockedReason,
}: ConnectorInstanceActionGateInput): ConnectorInstanceActionGates {
  const write = (blocked: string | null) =>
    decideActionGate({ allowed: capabilities.write, blocked });
  return {
    edit: write(lockedReason),
    sync: write(lockedReason),
    reconnect: write(null),
    editLayoutPlan: write(lockedReason),
    delete: decideActionGate({
      allowed: capabilities.delete,
      blocked: lockedReason,
    }),
    createEntity: decideActionGate({
      allowed: canCreateEntity,
      blocked: !isWriteEnabled ? WRITES_DISABLED_REASON : lockedReason,
    }),
    canEditFlags: capabilities.write,
  };
}
