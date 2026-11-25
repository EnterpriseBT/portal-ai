# Own portals by default — Discovery

**Issue:** [EnterpriseBT/portal-ai#1127](https://github.com/EnterpriseBT/portal-ai/issues/1127)

**Why this exists.** A portal is a person's chat session: the questions they asked and the answers they got. Members see only their own, but owners and admins see every portal in the org. They can read anyone's session, and even post into it, without any grant ever having been made for that. The user's rule: **by default each person sees only their own portals, owners and admins included. An explicit RBAC grant (a custom policy or a direct grant) that gives someone access to others' portals is fine, and must keep working.** This is a change to the default, not to the permission system.

It also matters to the Launcher epic (#1084). The header's New portal button picks the caller's last-used station; #1075 added `mine=true` for that. And the dashboard's Recent portals shows owners and admins their teammates' sessions.

This is the permission-engine rule that keeps the built-in roles' wildcard grant from reaching other people's portals, while explicit grants still do.

## The current shape

### Built-in roles and their statements

| Piece | Location | Note |
|---|---|---|
| System policies | `apps/api/src/services/seed.service.ts:719-826` (`SEED_SYSTEM_POLICIES`) | `{effect, verb, resourceType, condition, resourceId?}` (`:701-711`) |
| FullAccess (owner) | `seed.service.ts:730` | One statement: `allow * *` |
| AdminAccess (admin) | `seed.service.ts:739-746` | `allow * *`, plus `deny manage billing` and `deny delete org` |
| MemberAccess (member) | `seed.service.ts:760-785` | Per `DATA_RESOURCE_TYPES`: read/write/delete `created_by_caller`, read `created_by_system`; `portal` is one (`packages/core/src/models/permission.model.ts:114-121`) |
| Vocabulary | `permission.model.ts:26-65, 146-149` | Verbs and types include `*`; conditions are `created_by_caller` and `created_by_system` only |
| Portals aren't shareable | `permission.model.ts:129-134`; `grant.service.ts:156` | No `share portal`; the share flow can't grant them |

### Storage

System policies are **rows per org** in `roles`, `permission_policies`, `permission_statements` and `policy_attachments` (`apps/api/drizzle/0101_add_rbac_engine.sql`). `kind='system'` rows can't be edited through the API (`policy.service.ts:103-106`). They're seeded at provisioning by `seedRbacSystemPolicies` (`seed.service.ts:621-696`), with deterministic ids (`sysstmt:<org>:<policy>:…`), and backfilled by migration for existing orgs (`0102`, and insert-only `0106/0110/0111/0116/0129`; `0112` and `0128` changed or deleted rows). Policies are loaded fresh on every request (`permission.service.ts:125-173`), with no cache.

### Evaluation (`apps/api/src/services/permission-set.ts`)

- `loadSet` is the union of role, user and group policy statements plus ad-hoc grants (`permission.service.ts:159-172`).
- `resolve` (`:365-374`): any matching deny wins, then any allow, otherwise deny. `matches` (`:376-388`) treats `*` as any verb or type.
- `visibilityPredicate` (`:274-325`): an unconditional class-level allow (including `* *`) means no filter. Otherwise it ORs `createdBy = caller`, `= system` and `id IN (instance allows)`.
- **Boundary.** `assertStatementsWithinBoundary` (`:179-264`) and `assertWithinBoundary` (`:146`): an author can only write statements their own set already covers. A class-level statement is checked against a placeholder creator; an instance statement against the object's real `createdBy`. Authoring custom policies needs the `customRbac` entitlement (`policy.service.ts:49`).
- **The RBAC instance picker** lists objects through `visibilityPredicate` (`rbac-object-search.service.ts:71-77, 129`).

### Who checks portal access

Everything goes through the engine; there's no role-name bypass.
- **`PortalAccessService.load`** (`apps/api/src/services/portal-access.service.ts:29-45`): 404 if unreadable, 403 if the verb isn't allowed. Its comment at `:5-7` says "owners/admins (`* *`) reach all".
- **`portal.router.ts`:** create `:98-134` (`CREATE_RULES.portal = "owned"`, `permission.service.ts:102`); list `:234-289` (the `visibilityPredicate` at `:260-265`); get, reset, rename, delete, post message, running jobs.
- **Other routes:**
  - `portal-events.router.ts:90-180`: write check at `:150`; the turn runs as the message's author, which exists for owners driving members' portals;
  - `portal-map.router.ts:113-135`;
  - `portal-sql-handle.router.ts:120-139, 255-268`;
  - `portal-results.router.ts:187, 545` (pin create needs read on the source portal; pin reads follow pin rules).
- **Capabilities** from `ObjectCapabilitiesService` (`object-capabilities.service.ts:43-88`).
- **No agent tool reads portals.**

### Web

- **Lists:** the dashboard's Recent portals (`apps/web/src/components/RecentPortalsList.component.tsx:100-106`) and the station page's Portals list (`views/StationDetail.view.tsx:78-79, 330-375`) show whatever the list returns.
- **A stale comment:** `views/Portal.view.tsx:57`'s says an owner viewing someone else's portal lacks write; with `* *` they have it.
- **Authoring UI:** `modules/AccessAuthoring/StatementEditor.component.tsx` can scope a `portal` statement to instances or to an ownership condition.

## The design space

### Decision 1 — how the default stops reaching others' portals

**A. Replace each system `* *` with per-type statements that leave `portal` out**, plus `* portal created_by_caller`. A migration deletes the two `* *` rows in every org and inserts the per-type rows.
- **Upside:** the data says exactly what each role grants.
- **Downside:** it trades the wildcard for a list, so every resource type added later has to be added to both roles by hand, with a backfill each time. Miss one and owners silently lose it.

**B. A deny on others' portals.** It needs a new "not created by caller" condition. And a deny beats every allow, so it would also cancel the explicit grants the issue says must keep working.

**C. A rule in the engine: a wildcard resource type covers a *personal* type only for the caller's own objects.** `portal` is the one personal type (`PERSONAL_RESOURCE_TYPES`, core). In `matches`, a statement whose `resourceType` is `*` applies to a portal only when its creator is the caller, as if it carried `created_by_caller`. In `visibilityPredicate`, a wildcard statement contributes `createdBy = caller` for portals rather than "no filter". A statement that names `portal` (class-level, an instance, or a condition) applies as written.

| | A | B | C |
|---|---|---|---|
| Explicit grants keep working | yes | **no** (deny wins) | yes |
| Migration / backfill | yes (delete + insert per org) | yes | **none** |
| A future resource type | must be added to both roles, with a backfill | covered | covered by the wildcard |
| Where the rule lives | data | data + new condition | one engine rule + one constant |
| A custom `* *` policy | unchanged (still sees all portals) | — | also own-only for portals (consistent with "by default") |

**Lean: C.** It changes exactly the default and nothing else. There's no migration, and new types stay covered. Explicit `portal` statements remain the way to grant more. The rule sits in the one place every portal check already passes through.

### Decision 2 — who can grant access to others' portals

Under A or C, an owner or admin no longer holds unconditional portal access. So the boundary (`permission-set.ts:179-264`) refuses their `allow read portal` or `read portal:<someone else's>` with `RBAC_POLICY_EXCEEDS_BOUNDARY`. Nobody could grant the access the issue says is fine.

**A. Keep the boundary as is.** Nobody holds others' portals by default, so nobody can grant them. That contradicts the issue.

**B. Delegation versus access.** For the boundary only, a wildcard resource *does* cover personal types. An author whose set has `* *` (owner, admin, or a custom wildcard policy) may write portal statements beyond their own access. Access checks keep Decision 1's rule.

**C. A separate permission to grant portals** (a new verb). It's more vocabulary and more seed rows for the same outcome.

**Lean: B.** The authority to hand out access stays with those who hold everything, while their own access is limited by default. One consequence, stated plainly: an admin can grant themselves access to others' portals. That's an explicit, recorded act through policy authoring, and it's the "explicit RBAC grant" the issue allows.

### Decision 3 — the instance picker for `portal` statements

The picker lists objects the author can see, which after this change means only their own portals. Listing others' portals there would show the titles of their sessions (often the first question asked).

**Lean:** keep the picker scoped to what the author can see. Grants to others' portals are made at class level (`read portal`, optionally with a condition), not by picking someone's session by name.

## Tradeoff comparison

| | D1: engine rule (C) | D2: delegation (B) | D3: picker scoped |
|---|---|---|---|
| Spread to spec | Yes | Yes | Yes |
| Touches data | No | No | No |
| Touches the contract | `PERSONAL_RESOURCE_TYPES` in core | none | none |

## Recommendation

1. Add `PERSONAL_RESOURCE_TYPES = ["portal"]` to `packages/core/src/models/permission.model.ts`, documented as "types a wildcard resource covers only for the caller's own objects".
2. In `PermissionSet.matches`, a statement with `resourceType: "*"` matches a personal type only when the target's `createdBy` is the caller; with no target (a class-level check), it counts as `created_by_caller`. A statement naming the type applies as written.
3. In `PermissionSet.visibilityPredicate`, a wildcard statement contributes `createdBy = caller` for a personal type instead of "unrestricted". Explicit portal statements contribute as today.
4. In `assertStatementsWithinBoundary` / `assertWithinBoundary`, a wildcard resource keeps covering personal types, so an owner or admin can author portal grants beyond their own access.
5. No migration and no change to `SEED_SYSTEM_POLICIES`. The owner, admin and member roles are untouched as data.
6. `canPerformAny("portal", …)` and `ObjectCapabilitiesService` follow from the engine. Portal rows the caller can see carry capabilities as before.
7. Update the stale comments (`portal-access.service.ts:5-7`, `portal.router.ts:258-259`, `portal-events.router.ts:153-158`, `Portal.view.tsx:57`, `permission-set.ts:291`). Add a line to the Help glossary's Portal entry: portals are private to their creator unless access is granted.

## Open questions

1. **Portals already opened by an owner in someone else's session.** Owners and admins could post into members' portals. After this, the next request 404s. Is any notice needed? Lean: no; it's the intended effect, and nothing in the UI promoted cross-user portals.
2. **Should the change ship to prod on its own?** It changes what owners and admins can see. Lean: yes, a normal release with a release-notes line ("owners and admins now see only their own portals unless granted"); no vendor step.
3. **A custom wildcard (`* *`) policy authored for an auditor role.** Under C it also stops covering others' portals. Lean: that's consistent with "by default"; an auditor who should read sessions gets an explicit `read portal` statement. Say so in the release notes.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A. The rule is evaluated per request from statements already loaded fresh, so there's no cache to invalidate and no race.
- **Accuracy & auditability:** Lean: explicit portal grants are policy rows, as today, so who was granted access to others' sessions stays recorded in the policy tables. Nothing new is ephemeral.
- **Failure modes:** Lean: fail closed. If the rule can't establish the creator for a portal check, the wildcard doesn't cover it (404/403), never "allow".
- **Scale & unbounded growth:** N/A. The list's predicate gains a `createdBy = caller` term, which the existing per-org indexes serve; no new fan-out.
- **Multi-tenancy:** Lean: this strengthens isolation *inside* an org, between users; the org filter is untouched.
- **Contract stability:** Lean: `PERSONAL_RESOURCE_TYPES` is the hook for future personal types, and a sharing feature later is explicit statements on `portal`, which the boundary already lets owners and admins author.
- **Data lifecycle:** N/A. No data changes; existing portals and pins are untouched.

## What this doesn't decide

- **Portal sharing as a product feature** (a Share button for sessions). The user may add it later. It would build on explicit `portal` statements.
- **Pinned results:** they keep their own sharing rules. A pin from someone else's portal stays readable by those its own rules allow; the pin list's source-portal name already shows only when the portal is readable (`portal-results.router.ts:545`).
- **Other per-user types.** None today; the constant makes the next one a one-line change, but adding one is out of scope.

## Next step

`docs/OWN_PORTALS_BY_DEFAULT.spec.md` pins the engine rule (`matches`, `visibilityPredicate`, the boundary), the core constant and the test matrix. `docs/OWN_PORTALS_BY_DEFAULT.plan.md` then slices it in two commits:
1. **The engine rule and its unit tests:** the `permission-set.test.ts` parity matrix and boundary cases.
2. **Route integration tests, comments and Help copy:**
   - `portal.router.authorization.integration.test.ts`: owners and admins see only their own; an explicit `read portal` grant still shows others';
   - the capability agreement test;
   - the comments and Help glossary line.
