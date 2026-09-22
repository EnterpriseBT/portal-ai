# rbac-custom-authoring — Smoke Suite

Manual smoke test for [#622](https://github.com/EnterpriseBT/portal-ai/issues/622) — org-defined custom RBAC: the `group` principal, custom policy/role/group authoring, the statement boundary, the `customRbac` tier entitlement, and the "Access" Settings tab. **Branch under test:** `feat/622-rbac-custom-authoring` (PR [#626](https://github.com/EnterpriseBT/portal-ai/pull/626)).

Walked across the multi-user `@portalai/e2e` org — **owner / admin / member** — via `e2e:use <role>` + `browser_close`/`browser_navigate`. Authoring is owner/admin; the member is the target whose inherited access is checked.

> **Walk history:** the owner-context walk surfaced five issues, fixed in-branch before this doc was finalized — (1) policy create posted an empty statement set → 400; (2) "New policie" label; (3) system read-only left statement selects editable; (4) member-centric group assignment was never built; (5) custom roles could not be assigned to members. All are reflected in the expected results below (and covered by unit tests); the remaining unchecked boxes are the admin/member-context and DB/manual steps.

## Preflight

### Environment

- [ ] `git checkout feat/622-rbac-custom-authoring && git pull --ff-only`
- [ ] `npm install`
- [ ] **Migrate** — `cd apps/api && npm run db:migrate` applies `0107_add_groups_and_user_group` + `0108_add_tiers_custom_rbac` + `0109_add-roles-slug` (adds `roles.slug`, backfilled). Confirm all three print as applied.
- [ ] **After any `@portalai/core` rebuild, restart the API** (`npm run dev` / nodemon watches `apps/api/src`, not core's dist) — a stale core schema otherwise 400s the role/group endpoints with a mismatched-schema error.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)

### Fixtures

- [ ] Seeded multi-user org — `npm run --workspace @portalai/e2e e2e:seed` (owner/admin/member on the `e2e-fixture` org); auth cached via `e2e:auth:all`.
- [ ] **The org's tier must grant `customRbac`.** Locally: `UPDATE tiers SET custom_rbac = true WHERE slug = 'standard';` (a local convenience — prod entitlement rides the enterprise catalog flag). Confirm `GET /api/organization/usage` returns `tier.entitlements.customRbac: true`.

### Reset between runs

- [ ] Custom policies/roles/groups hard-/soft-delete cleanly; delete any created during the walk, or `e2e:seed` for a fresh org. To re-test the locked state, `UPDATE tiers SET custom_rbac = false WHERE slug = 'standard';`.

## §1 — The "Access" tab & its gates (slice 6) — AC: authoring requires capability + entitlement

- [ ] As **owner**, open Settings. **Expected:** an **"Access"** tab is present (after Activity).
- [ ] As **member**, open Settings. **Expected:** **no** Access tab (member lacks `member.role.assign`); deep-linking `?tab=access` falls back to Profile.
- [ ] As **owner** on an org whose tier lacks `customRbac` (flip it false first), open Access. **Expected:** a **locked/upgrade** state ("Custom roles, policies, and groups are an enterprise feature"), not the authoring module. — manual (needs the tier toggled)
- [ ] Restore `customRbac: true`; the Access tab now shows the Policies / Roles / Groups sub-nav.

## §2 — Custom policy authoring (slices 3, 6) — AC: bounded create, instance picker, system read-only

- [ ] As **owner**, Access ▸ Policies ▸ **New policy** (button reads "New policy", not "New policie"). Name `Analysts`. Leave the default statement (`allow · read · station · scope "All of type"`) untouched. Save. **Expected:** success toast; `Analysts` appears with "1 statement" (a save with no statement edits must NOT 400 — regression for the mount-emit fix).
- [ ] Edit `Analysts`; add a statement `allow · read · station · scope "Specific objects"`. **Expected:** a **searchable multiselect** appears; typing a name lists matching stations **by name** (no id entry). Pick 2 → Save. **Expected:** the policy now has "3 statements" (the instance row fanned out to 2).
- [ ] As **admin**, create a policy with `allow · * · *`. **Expected:** save is refused with the boundary error (`RBAC_POLICY_EXCEEDS_BOUNDARY`) in the dialog's `FormAlert` (admin can't grant billing-manage).
- [ ] As **owner**, open a **system** policy (e.g. `FullAccess`) via its **view (eye) icon** — system rows show an eye, not a pencil. **Expected:** it renders **read-only** — no Save; **every** field disabled (name, description, and the statement Effect/Verb/Resource/Scope selects); no Add statement; no Delete affordance in the list; actions show only **Close**.

## §3 — Custom role authoring (slices 4, 6) — AC: policy bundle, boundary, assignment

- [ ] As **owner**, Access ▸ Roles ▸ **New role**. Name `Analyst`, bundle the `Analysts` policy. Save. **Expected:** `Analyst` appears with "1 policy".
- [ ] As **admin**, create a role bundling the system `FullAccess` policy. **Expected:** refused with `RBAC_POLICY_EXCEEDS_BOUNDARY` (can't bundle access you lack).
- [ ] Assign `Analyst` to the **member** on the **Members tab**: open the member's **Roles** multiselect — it lists the custom `Analyst` **alongside** owner/admin/member. Select it, and the row shows an `Analyst` chip. **Expected:** the assignment succeeds (`PUT …/roles` with `roleSlugs`, addressed by the role's **slug**); a member's set always keeps ≥1 system role.
- [ ] As **member**, confirm the bundled access applies (e.g. a station list scoped by the policy). — manual (cross-identity effective-access check)
- [ ] System roles (owner/admin/member) render read-only — a **view (eye)** icon, no pencil, no delete.

## §4 — Group authoring + membership (slice 5, 6) — AC: a group's policies reach every member

- [ ] As **owner**, Access ▸ Groups ▸ **New group**. Name `West`, bundle `Analysts`, add the **member** as a member. Save. **Expected:** `West` appears with "1 member, 1 policy".
- [ ] As **member**, confirm the group's policy now applies (inherited via membership). — manual (cross-identity effective-access check)
- [ ] Remove the member from `West` (edit group). **Expected:** the member's inherited access is gone on their next load. — manual (cross-identity)
- [ ] Member-centric: Members tab → the **Groups** column (present only when the org is `customRbac`-entitled) → assign a group to another member. **Expected:** the member joins the group; `West`'s count rises (e.g. "2 members, 1 policy").

## §5 — Delete cascades + audit (slices 3–5) — AC: cascade-soft-delete + audited

- [ ] Delete the custom `Analyst` role. **Expected:** it disappears; its `user_role` assignments + `policy_attachments` are soft-deleted (DB: no live rows for the role id). — manual (DB inspection)
- [ ] Delete the `West` group. **Expected:** `user_group` + group-principal `policy_attachments` soft-deleted. — manual (DB inspection)
- [ ] Delete the `Analysts` policy. **Expected:** gone; its `policy_attachments` soft-deleted. — manual (DB inspection)
- [ ] Audit: every create/update/delete/assign wrote an `audit_log` row (`policy.*`, `role.*`, `group.*`, `group.member.*`, `policy.attach/detach`), attributed to the actor. — manual (DB: `audit_log.action`)

## §6 — Instance-picker scoping (slice 5) — AC: pick by name, visibility-scoped

- [ ] In the statement editor's "Specific objects" picker, the candidates are **only objects the author can see**; `field_mapping`/`entity_record` are class-level only (no "Specific objects" option). **Expected:** picker lists management objects (station/pin/portal/connector/entity) by name; data-plane types offer no instance picker.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/policy/role/group/audit ids):
