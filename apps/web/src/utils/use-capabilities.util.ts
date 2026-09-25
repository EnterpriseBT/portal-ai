import type {
  OrgRole,
  CallerCapabilityAction,
  NavPageId,
  ResourcePermissionType,
} from "@portalai/core/models";

import { sdk } from "../api/sdk";

/** The class-level `{read,write,delete}` shape per object type (#630). */
export interface ResourceVerbs {
  read: boolean;
  write: boolean;
  delete: boolean;
}

export interface CapabilityState {
  /** The caller's roles in the current org (empty until resolved). */
  roles: OrgRole[];
  /** The caller's custom group names in the current org (#622; empty until
   *  resolved or when the org authors no groups). */
  groups: string[];
  /**
   * Whether the caller may perform an app-level action, computed server-side
   * from their attached policies (#620). This is the FE's only gating
   * primitive — never a role-name heuristic (`isOwner`/`isAdmin` are gone). The
   * server's `PermissionService` is the real boundary; `can` drives the honesty
   * affordances (hide/disable what the caller can't do).
   */
  can: (action: CallerCapabilityAction) => boolean;
  /**
   * Whether the caller may `view` a nav page/sub-tab (#630) — drives sidebar
   * visibility + the route-redirect guard. Fail-closed: an ungranted or
   * not-yet-loaded page is `false`. Page-view is a **separate** resource from
   * object `read` (a member may read their own connector without seeing the
   * Connectors page).
   */
  canViewPage: (pageId: NavPageId) => boolean;
  /** Coarse class-level object permission (#630) — for affordances only; the
   *  per-object boundary stays a server check. Fail-closed. */
  canOnResource: (
    type: ResourcePermissionType,
    verb: keyof ResourceVerbs
  ) => boolean;
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
  const pagePermissions = data?.pagePermissions;
  const resourcePermissions = data?.resourcePermissions;
  return {
    roles: data?.roles ?? [],
    groups: data?.groups ?? [],
    can: (action) => capabilities?.[action] ?? false,
    canViewPage: (pageId) => pagePermissions?.[pageId] ?? false,
    canOnResource: (type, verb) => resourcePermissions?.[type]?.[verb] ?? false,
    capabilitiesKnown: data !== undefined,
  };
}
