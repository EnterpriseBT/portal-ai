# Group member editing — Discovery

**Issue:** [EnterpriseBT/portal-ai#637](https://github.com/EnterpriseBT/portal-ai/issues/637)

**Why this exists.** The #622 group authoring dialog can create a group with members, but it can neither **show** nor **change** a group's members on edit. Re-opening an existing group renders an empty Members field, and adding a member via edit is silently dropped — the container resets `memberIds` to `[]` on every open and only calls `setMembers` on the *create* path. Because a member joins a group's policies through `user_group` (resolved in `loadSet`), the practical effect is that RBAC-via-group can't be administered after creation: attach a nav/data policy to a group, then add a user later → the user never actually joins → no access (the exact failure that surfaced validating #630). This is the fix that makes group membership editable — load it, save it — end to end.

## The current shape

### Frontend — the dialog (the bug lives here)

| Piece | Location | Note |
|---|---|---|
| `memberIds` state | `apps/web/src/modules/AccessAuthoring/GroupEditorDialog.component.tsx:138` | Initialized to `[]` — never seeded from the group. |
| open-effect | `GroupEditorDialog.component.tsx:147-154` | Re-seeds name/description/policyIds from `group`, but **resets `memberIds` to `[]`** every open. |
| submit | `GroupEditorDialog.component.tsx:176-186` | Calls `setMembers` **only on create** (`else` branch); on edit it just invalidates. In-file comment admits it: *"On edit we don't re-drive membership … only set on create."* |
| member options | `GroupEditorDialog.component.tsx:159-161` | `sdk.members.list` → the pick list (all org members); this is fine. |

### Backend — the read already exists

| Piece | Location | Note |
|---|---|---|
| `findUserIdsByGroup(groupId)` | `apps/api/src/db/repositories/user-groups.repository.ts:72` | **Already implemented** — returns the group's active member ids. |
| `countMembers` | `user-groups.repository.ts:84` | Derives the count as `findUserIdsByGroup(...).length` — so `toView` **already loads the ids** to count them. |
| `GroupService.toView` | `apps/api/src/services/group.service.ts:113-125` | Returns `{ id, name, description, policyIds, memberCount }` — **discards** the ids it computed. |
| `GroupService.setMembers` | `group.service.ts:322-344` | Group-centric membership set (org-checks members, diffs, audits). Already wired to `PUT /api/groups/:id/members` (`group.router.ts:294-308`). |
| `GroupViewSchema` | `packages/core/src/contracts/rbac-authoring.contract.ts` | `policyIds` + `memberCount`; **no member ids**. |
| group-policy resolution | `apps/api/src/services/permission.service.ts:91-100` | `loadSet` gathers the caller's groups and unions their attached policies — so once membership persists, access resolves. No engine change needed. |

## The design space

### Decision 1 — how to expose a group's member ids to the editor

**A. Add `memberUserIds` to `GroupView`.** `toView` already computes the ids (via `countMembers` → `findUserIdsByGroup`); return them alongside `memberCount`. The group list the dialog already consumes then carries the ids; the dialog seeds from `group.memberUserIds`.

**B. New `GET /api/groups/:id/members`.** A dedicated read the dialog fetches on open; keeps the list payload lean.

| | A — field on GroupView | B — detail endpoint |
|---|---|---|
| New query cost | **Zero** — `toView` already loads the ids | One fetch per edit-open |
| New surface | +1 additive contract field | + route + contract + sdk + service method + FE fetch |
| List payload | grows with group size | unchanged |
| FE change | seed from the prop already passed | add a query + loading state |

**Decision: B** (revised in review — some orgs will have **hundreds of users**, so a group can hold hundreds of members). A ships `memberUserIds` on **every group-list row**, scaling the list payload with total membership for a value only the *edit* dialog needs. B pays one small fetch exactly when the editor opens one group. The read is **gated by the normal members-read permission** — org membership only (`SeatService.listMembers` requires just that, #621: "every member can see who else is in the org"), org-scoped to the group — **not** the customRbac authoring gate. `findUserIdsByGroup` still backs it, so there's still no new query *logic*, just a dedicated route.

### Decision 2 — saving membership on edit

The submit path must call `setMembers` on **edit** too, not only create. `setGroupMembers` computes an added/removed **diff**, so calling it with an unchanged set is a clean no-op (empty diff, no audit rows).

**Lean: unify** — always call `setMembers(id, memberIds)` after create/update, dropping the create-only branch.

## Tradeoff comparison

| | Decision 1 (A: field on GroupView) | Decision 2 (unify setMembers) |
|---|---|---|
| Spread to spec | Yes — schema + `toView` + FE seed | Yes — FE submit |
| New endpoint | No | No |
| Contract change | additive field | none |

## Recommendation

1. Add `GET /api/groups/:id/members` → `{ userIds: string[] }`, gated by **org membership** (`getApplicationMetadata`, like `SeatService.listMembers`) + org-scoped to the group (`GroupService.load` → 404 cross-org). **Not** the customRbac authoring gate.
2. `GroupService.listMembers(caller, id)` — `load` (org-scope) then `userGroups.findUserIdsByGroup(id)`; no authoring gate.
3. `sdk.groups.members(id)` — a `useAuthQuery` fetched only when the edit dialog opens a group.
4. `GroupEditorDialog` seeds `memberIds` from that query when it resolves for the opened group, and calls `setMembers` on **both** create and edit.
5. `GroupView` is **unchanged** (keeps `memberCount`, no member-id list) — the list stays lean at hundreds-of-users scale.

## Open questions

1. **Return shape — `{ userIds }` vs full member details?** The dialog resolves labels from the roster it already loads (`sdk.members.list`), so it needs only ids; `{ userIds }` is leanest and mirrors the `PUT` request (`GroupMembersSetRequest = { userIds }`). **Lean: `{ userIds: string[] }`.**
2. **Gate — members-read (org membership) vs the group authoring gate?** Reading who is in a group is a roster read, no more sensitive than the org roster every member can already see. **Lean: members-read (org membership), per the user's call** — distinct from `GroupService.get`, which stays authoring-gated.

## Enterprise-scale considerations

- **Scale & unbounded growth** — *the driver for Decision B.* Some orgs have hundreds of users → hundreds of group members. A dedicated read is fetched **once per edit-open**, never on the group list, so the list payload stays flat regardless of membership size. If a single group ever holds thousands, the endpoint can paginate later (contract already isolates it).
- **Concurrency & correctness** — `setMembers` is a diff-based full-set replace; two concurrent group edits are last-writer-wins. Acceptable for a low-concurrency admin-authoring surface — `N/A (deeper)`.
- **Multi-tenancy** — preserved: the read org-scopes via `GroupService.load` (404 cross-org), and `getApplicationMetadata` proves the caller belongs to the org (the same boundary `SeatService.listMembers` relies on). `setMembers`'s `assertMembers` still verifies every id is an active org member.
- **Accuracy / failure modes** — read-time only; no ledger. Fail-closed: a read failure shows no members rather than wrong ones. Cache freshness via the existing `queryKeys.groups.root` invalidation after `setMembers`, plus the per-group members query key.
- **Contract stability** — additive **endpoint** (no `GroupView` change); the member-centric path (`setGroupsForUser`, Members tab) is untouched and still works.

## What this doesn't decide

- **Member-centric editing** (`GroupService.setGroupsForUser` / the Members tab) — already functional; out of scope.
- **Pagination of the members endpoint** — deferred; the `{ userIds }` contract isolates it, so it can page later without touching callers. Not needed until a single group holds thousands.
- **Any change to `loadSet` / policy resolution** — group→policy already resolves correctly; this ticket only makes membership editable.

## Next step

`docs/GROUP_MEMBER_EDITING.spec.md` pins the `GET /api/groups/:id/members` contract + gate, `GroupService.listMembers`, the `sdk.groups.members` query, and the dialog seed/save; `docs/GROUP_MEMBER_EDITING.plan.md` slices it — **2 slices**: (1) core+api+sdk (the endpoint, service read, response contract, and the query, with the group-router integration test) and (2) web (dialog fetch-seed + unified `setMembers`, with the dialog unit test).
