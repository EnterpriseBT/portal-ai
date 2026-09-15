import type { OrgRole } from "@portalai/core/models";

import { sdk } from "../api/sdk";

export interface RoleState {
  /** The caller's role in the current org, or null until it resolves. */
  role: OrgRole | null;
  isOwner: boolean;
  isAdmin: boolean;
  /** owner OR admin — the elevated set (audit log, member management). */
  isAdminOrOwner: boolean;
  /** true once the current-org query has resolved (role is known). */
  roleKnown: boolean;
}

/**
 * Role-aware gating primitive (#576). The single source of the caller's role is
 * `sdk.organizations.current()` — never recomputed from `ownerUserId` per
 * component. Server-side `PermissionService` is the real boundary; this drives
 * the UI honesty affordances (hide/disable what a role can't do).
 */
export function useRole(): RoleState {
  const { data } = sdk.organizations.current();
  const role = data?.role ?? null;
  return {
    role,
    isOwner: role === "owner",
    isAdmin: role === "admin",
    isAdminOrOwner: role === "owner" || role === "admin",
    roleKnown: data !== undefined,
  };
}
