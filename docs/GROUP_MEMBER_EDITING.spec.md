# Group member editing — Spec

Pins the contract for making a group's membership **loadable and editable** (#637) via a **dedicated members endpoint** (Decision 1B — chosen for hundreds-of-users orgs). Discovery: `docs/GROUP_MEMBER_EDITING.discovery.md`. Issue: [#637](https://github.com/EnterpriseBT/portal-ai/issues/637).

## Key decisions (flag for review)

1. **Dedicated read endpoint** `GET /api/groups/:id/members` (Decision 1B) — **not** a field on `GroupView`. Fetched only when the edit dialog opens one group, so the group *list* payload stays flat at hundreds-of-members scale.
2. **Gated by the normal members-read permission** — **org membership only** (`getApplicationMetadata` + org-scoped group), mirroring `SeatService.listMembers` (#621: every member can read the org roster). **Not** the customRbac authoring gate that `GroupService.get`/`setMembers` use.
3. **Return `{ userIds: string[] }`** — the dialog resolves labels from the roster it already loads; mirrors the `PUT …/members` request shape.
4. **Unify `setMembers`** — the dialog calls it on **both** create and edit.
5. **No `GroupView` change, no schema change, no engine change** — the read (`findUserIdsByGroup`) and write (`PUT /:id/members`) already exist.

## Scope

### In scope
- New `GET /api/groups/:id/members` → `{ userIds }`, org-membership-gated + org-scoped.
- `GroupService.listMembers`, `sdk.groups.members`, and the `GroupEditorDialog` fetch-seed + unified save.

### Out of scope
- `GroupView` shape (unchanged — keeps `memberCount`).
- Member-centric editing (`setGroupsForUser` / Members tab) — already works.
- Members-endpoint pagination — deferred; the `{ userIds }` contract isolates it.
- Any `loadSet` / policy-resolution change.

## Surface

### `packages/core/src/contracts/rbac-authoring.contract.ts` — response schema

Add beside `GroupMembersSetRequestSchema`:

```ts
/** `GET /api/groups/:id/members` — the group's active member user ids. */
export const GroupMembersResponseSchema = z.object({
  userIds: z.array(z.string()),
});
export type GroupMembersResponse = z.infer<typeof GroupMembersResponseSchema>;
```

`GroupViewSchema` is **unchanged**.

### `apps/api/src/services/group.service.ts` — `listMembers`

New static method — org-scoped read, **no authoring gate** (the members-read gate is org membership, proven at the route):

```ts
/** A group's active member ids. Members-read gate: org membership (the route's
 *  getApplicationMetadata) + org-scoped group — NOT the customRbac authoring
 *  gate, mirroring SeatService.listMembers (#621). */
static async listMembers(
  caller: PermissionContext,
  id: string
): Promise<string[]> {
  const group = await GroupService.load(caller, id); // 404 if cross-org/absent
  return DbService.repository.userGroups.findUserIdsByGroup(group.id);
}
```

Reuses `GroupService.load` (`group.service.ts:56-65`, org-scope → `GROUP_NOT_FOUND` 404) and `userGroups.findUserIdsByGroup` (`user-groups.repository.ts:72`). No new repository code.

### `apps/api/src/routes/group.router.ts` — `GET /:id/members`

New route, `getApplicationMetadata` only (like the other group routes), registered so `/:id/members` sits beside the existing `PUT /:id/members`:

```ts
groupRouter.get(
  "/:id/members",
  getApplicationMetadata,
  async (req, res, next) => {
    try {
      const userIds = await GroupService.listMembers(
        req.application!.metadata,
        req.params.id
      );
      return HttpService.success<GroupMembersResponse>(res, { userIds });
    } catch (error) { /* next(ApiError | 500 GROUP_FETCH_FAILED) — mirror the sibling routes */ }
  }
);
```

`@openapi` block: `GET /api/groups/{id}/members`, tag `Groups`, `bearerAuth`, `200` → `$ref: '#/components/schemas/GroupMembersResponse'`, `404` → `ApiErrorResponse`. Register `GroupMembersResponse` under `components.schemas` in `apps/api/src/config/swagger.config.ts` (via `z.toJSONSchema(GroupMembersResponseSchema)`), per the API style guide. No new `ApiCode` (reuse the existing group 404 / fetch-failed).

### `apps/web/src/api/keys.ts` + `groups.api.ts` — the query

- `keys.ts`: `groups: { root: ["groups"] as const, members: (id: string) => ["groups", id, "members"] as const }`.
- `groups.api.ts`: add a read —

```ts
members: (id: string, options?: QueryOptions<GroupMembersResponse>) =>
  useAuthQuery<GroupMembersResponse>(
    queryKeys.groups.members(id),
    `/api/groups/${encodeURIComponent(id)}/members`,
    undefined,
    options
  ),
```

### `apps/web/src/modules/AccessAuthoring/GroupEditorDialog.component.tsx` — container

- Fetch: `const membersQuery = sdk.groups.members(group?.id ?? "", { enabled: open && !!group })` (skipped for create).
- Seed: when `membersQuery.data` resolves for the opened group, set `memberIds` to `data.userIds` **once per open** (a `seededRef` reset in the open-effect prevents clobbering a later user edit). Create opens with `memberIds = []`.
- Save: `handleSubmit` calls `sdk.groups.setMembers.mutateAsync({ id, userIds: memberIds })` on **both** branches (created id on create, `group.id` on edit), then `invalidate()`.
- `GroupEditorDialogUI` (pure) is unchanged.

Uses existing `sdk.groups.setMembers` (`groups.api.ts:45`) + `sdk.members.list` (options). Cache: keep the `queryKeys.groups.root` invalidation; also fine to leave the per-group members key to refetch on next open (`enabled` gate).

## Migration / Seed

**None.** Read-time only — no column, migration, or seed change.

## TDD test plan

### core — `packages/core/src/__tests__/contracts/rbac-authoring.contract.test.ts`
- `GroupMembersResponseSchema` accepts `{ userIds: ["u-1","u-2"] }` and `{ userIds: [] }`; rejects a missing `userIds`.

### api (integration) — `apps/api/src/__tests__/__integration__/routes/group.router.integration.test.ts`
- `GET /api/groups/:id/members` returns the seeded member ids for a group with members; empty group → `{ userIds: [] }`.
- **Org-scope:** a group id from **another org** → **404** (no cross-tenant read).
- **Members-read gate:** a plain **member** (no `member.role.assign`, may lack customRbac) → **200** with the ids — proving the lighter gate (contrast: `GET /api/groups/:id` stays authoring-gated).

### web (unit, container-level) — `apps/web/src/__tests__/GroupEditorDialog.test.tsx` (new)
SDK-mocked (`jest.unstable_mockModule`) + `test-utils` `queryClient`:
- **Edit seeds members:** `sdk.groups.members` mocked to `{ userIds:["u-1"] }`; on edit-open the Members select shows the seeded member (not empty).
- **Edit saves membership:** submit on an existing group calls `sdk.groups.setMembers` with `{ id: group.id, userIds }`.
- **Create still saves membership:** submit on `group={null}` calls `setMembers` with the created id + ids (regression guard for the unified path).

Run: `cd packages/core && npm run test:unit`; `cd apps/api && npm run test:integration`; `cd apps/web && npm run test:unit` (never raw jest).

**Totals ≈ 8 cases.** No migration/seed test.

## Acceptance criteria

- Re-opening an existing group in the editor shows its current members (fetched from the endpoint), not an empty field.
- Adding/removing a member via edit and saving persists to `user_group` (verifiable via the members endpoint + `loadSet` granting the group's policies).
- Creating a group with members still persists them.
- `GET /api/groups/:id/members` returns `{ userIds }`, is **404** for a cross-org group, and is readable by **any org member** (org-membership gate).
- The group **list** payload is unchanged (no member ids on `GroupView`) — flat regardless of membership size.

## Risks & rollback

- **Gate correctness** — the read is deliberately lighter than group authoring; risk is under- or over-gating. Mitigated by the org-scope (`load` → 404) + the explicit members-read gate test (a member reads; cross-org 404). Fail-closed: an unreadable group → 404, not a leak.
- **Seed race (FE)** — the async fetch seeds after open; the `seededRef` seeds once per open so a fast user edit isn't clobbered. Low risk (small dialog, fast local fetch).
- **Rollback** — revert the edits; no migration, no data written.

## Files touched

- Edit: `packages/core/src/contracts/rbac-authoring.contract.ts` (+ `GroupMembersResponseSchema`).
- Edit: `apps/api/src/services/group.service.ts` (+ `listMembers`).
- Edit: `apps/api/src/routes/group.router.ts` (+ `GET /:id/members` + `@openapi`); `apps/api/src/config/swagger.config.ts` (+ component).
- Edit: `apps/web/src/api/keys.ts` (+ `groups.members`), `apps/web/src/api/groups.api.ts` (+ `members` query).
- Edit: `apps/web/src/modules/AccessAuthoring/GroupEditorDialog.component.tsx` (fetch-seed + unified `setMembers`).
- Edit (tests): `packages/core/src/__tests__/contracts/rbac-authoring.contract.test.ts`, `apps/api/src/__tests__/__integration__/routes/group.router.integration.test.ts`.
- New (test): `apps/web/src/__tests__/GroupEditorDialog.test.tsx`.

## Next step

`docs/GROUP_MEMBER_EDITING.plan.md` slices this into **2 TDD commits**: (1) **core + api + sdk** — the response schema, `GroupService.listMembers`, the route + swagger component, and the `sdk.groups.members` query, greened by the contract + group-router integration cases; (2) **web** — the dialog fetch-seed + unified `setMembers`, greened by the new container test. Slice 1 is self-contained (endpoint + query, nothing consumes them yet); slice 2 wires the dialog.
