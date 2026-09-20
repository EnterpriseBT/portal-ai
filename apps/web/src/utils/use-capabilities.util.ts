import type { OrgRole, CallerCapabilityAction } from "@portalai/core/models";

import { sdk } from "../api/sdk";

export interface CapabilityState {
  /** The caller's roles in the current org (empty until resolved). */
  roles: OrgRole[];
  /**
   * Whether the caller may perform an app-level action, computed server-side
   * from their attached policies (#620). This is the FE's only gating
   * primitive — never a role-name heuristic (`isOwner`/`isAdmin` are gone). The
   * server's `PermissionService` is the real boundary; `can` drives the honesty
   * affordances (hide/disable what the caller can't do).
   */
  can: (action: CallerCapabilityAction) => boolean;
  /** true once the current-org query has resolved (capabilities are known). */
  capabilitiesKnown: boolean;
}

/**
 * Capability-aware gating primitive (#620, replacing #576's `useRole`). The
 * single source is `sdk.organizations.current()`, which returns the caller's
 * `roles` + a server-computed `capabilities` map. Components gate on
 * `can("billing.manage")` etc. and display `roles` directly — never a role
 * name compared in the client.
 */
export function useCapabilities(): CapabilityState {
  const { data } = sdk.organizations.current();
  const capabilities = data?.capabilities;
  return {
    roles: data?.roles ?? [],
    can: (action) => capabilities?.[action] ?? false,
    capabilitiesKnown: data !== undefined,
  };
}
