# rbac-multi-role — Smoke Suite

Manual smoke test for [#620](https://github.com/EnterpriseBT/portal-ai/issues/620) — the RBAC multi-role cutover: a user holds any number of roles per org (`user_role` join), the FE gates entirely on server-computed **capabilities** (no `isOwner`/`isAdmin`), and roles are set as a whole set via `PUT …/members/:id/roles`. **Branch under test:** `feat/620-rbac-multi-role` (PR [#624](https://github.com/EnterpriseBT/portal-ai/pull/624)).

> **This branch adds migrations** `0103_add_user_role` (the join table) and `0104_backfill-user-roles` (remap every existing membership). `npm run dev` seeds but does **not** migrate — you must run `db:migrate` in preflight or the app 500s on `user_role`.

## Preflight

### Environment

- [ ] `git checkout feat/620-rbac-multi-role && git pull --ff-only`
- [ ] `npm install`
- [ ] `cd apps/api && npm run db:migrate` — applies `0103` + `0104`; expect it to print both as applied, no error
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)
- [ ] Refresh the Playwright/e2e session if used: `npm run --workspace @portalai/e2e e2e:auth` (per [[feedback_playwright_login_means_refresh_fixture]])

### Fixtures

- [ ] A seeded org whose owner is your dev login (`bbgrabbag@gmail.com`) — `npm run --workspace @portalai/e2e e2e:seed` (or your existing dev org). The backfill (`0104`) must have run against it (preflight migrate).
- [ ] **At least one non-owner member** in that org to re-role. If none: Settings › Members › **Invite member** (role `member`), accept the one-time link in a second browser/profile, so the members table has ≥2 rows.
- [ ] *(Optional, for the member-perspective steps in §3)* the invited member's own login, to sign in as a non-owner.

### Reset between runs

- [ ] Mostly idempotent — role changes are reversible via the same Members editor. To fully reset the invited member, remove them (Members › trash icon) and re-invite. `0104` is a safe no-op re-run.

## §1 — Migration + backfill (existing access preserved)

*Acceptance: "every existing membership is remapped to `user_role` with identical access"; "a new org's owner is provisioned with a `user_role`". (spec tests 6, 10)*

- [ ] **db check — backfill** *(— manual: `db:studio` / psql, not browser)*: open `apps/api` › `npm run db:studio`, table `user_role` — every live `organization_users` row has a matching `user_role` row (`user_id`, `organization_id`, `role_id = sysrole:<org>:<role>`), none soft-deleted.
- [ ] **existing access unchanged**: as the owner, load `http://localhost:3000` — the app renders normally (dashboard, stations, portals all reachable). No access regression from the cutover.
- [ ] **new-org owner** *(— manual: requires a brand-new signup)*: provision a fresh org (new user first login, or `portalai org provision`) and confirm in `db:studio` the owner has a `user_role` row `sysrole:<neworg>:owner`.

## §2 — Multi-role assignment (union) via Settings › Members

*Acceptance: "a user can hold ≥2 roles; effective permissions = the union; single-role users unchanged"; "set-roles enforces owner-gating". (spec tests 5, 7)*

- [ ] As the owner, go to **Settings › Members**. The member row shows a **Roles** column with a multi-select (chips), not a single-role dropdown.
- [ ] Open the target member's Roles multi-select and add **admin** alongside **member** → the row now shows two chips (`admin`, `member`); a "Roles updated" toast appears.
- [ ] Reload the page — the two chips persist (the set was written, not just local state).
- [ ] **db check** *(— manual: `db:studio`)*: `user_role` has two live rows for that user (`sysrole:<org>:admin`, `sysrole:<org>:member`); `organization_users.role` mirror = `admin` (the highest).
- [ ] Remove **admin** from the multi-select → back to a single `member` chip; toast; `user_role` admin row is soft-deleted.

## §3 — Capability gating (no role-name heuristics)

*Acceptance: "the FE gates entirely on `capabilities` — no `isOwner`/`isAdmin`/`primaryRole`". (spec test 11)*

- [ ] As the **owner**: Settings shows the **Members** and **Activity** tabs; the **Organization** tab's "Delete organization" button is enabled; Subscription & Billing actions (Subscribe/Manage) are enabled.
- [ ] Promote the second member to **admin** (§2), then *(— manual: sign in as that member in a separate session)* open Settings as the **admin**: **Members** + **Activity** tabs are visible; "Delete organization" is **disabled** with a tooltip; billing Subscribe/Manage are **disabled** with "You don't have permission to manage billing".
- [ ] *(— manual: sign in as a plain **member**)* Settings shows **only** Profile / Organization / Subscription & Billing — **no** Members or Activity tab; deep-linking `http://localhost:3000/settings?tab=activity` falls back to the Profile tab.

## §4 — Roles + groups display (by name)

*Acceptance: "Members role column + Profile show `roles[]` by name". (spec test 9, D2c)*

- [ ] **Settings › Profile**: a **"Your roles"** section lists your role(s) as chips by name (e.g. `owner`), and a **"Your groups"** section shows the "You don't belong to any groups yet." placeholder (groups arrive in #622).
- [ ] **Settings › Members**: each member's Roles column renders their role name(s) as chips (`owner` / `admin` / `member`) — the raw slug/name, not a capitalized label.

## §5 — Guards & edge cases

*Acceptance: "set-roles enforces ≥1-role + last-owner + owner-gating"; "a role can't be assigned to a user twice". (spec tests 7, 8; risks)*

- [ ] **last-owner**: as the sole owner, open your **own** Roles multi-select and try to deselect `owner` (leaving no owner) → the change is rejected with a "Cannot remove the owner role from the organization's last owner" error toast; your `owner` chip remains.
- [ ] **owner-gating** *(— manual: as an **admin** caller)*: attempt to add `admin` to another member → rejected 403 (error toast) — only an owner may assign owner/admin.
- [ ] **≥1-role**: deselect every role for a member so the set would be empty → the request is rejected (the member keeps at least one role; the UI/serve does not persist an empty set).
- [ ] **no double-assign**: the multi-select cannot list a role twice; re-adding an already-held role is a no-op (still one chip, one `user_role` row) — verify in `db:studio` there is exactly one live row per (user, role). *(— manual: db check)*
- [ ] **co-owner + relax**: as owner, promote a second member to include `owner` → succeeds (two owners); now demoting the original owner is permitted (last-owner guard no longer trips). Restore afterward.

## §6 — Parity (single-role unchanged)

*Acceptance: "single-role users unchanged"; risk: "parity drift". (spec test 5)*

- [ ] A member holding exactly one role behaves exactly as pre-#620: a `member` sees only their own + system resources; an `admin` sees the Members/Activity tabs; an `owner` can manage billing + delete. (Covered incidentally by §3 — confirm nothing about single-role access changed.)

## Sign-off

- [ ] Every section above verified
- [ ] ______________________ (date + name) — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org id / user id / role id):
