# Group member editing — Plan

**Make a group's membership loadable + editable via a dedicated members endpoint, TDD-sequenced: ship the org-membership-gated read (endpoint + query), then wire the dialog to fetch-seed and save it.**

Spec: `docs/GROUP_MEMBER_EDITING.spec.md`. Discovery: `docs/GROUP_MEMBER_EDITING.discovery.md`. Issue: #637 (Bug; sibling of the #622 RBAC-authoring family). Builds on the existing `userGroups.findUserIdsByGroup` read and the `PUT /api/groups/:id/members` write — no migration, no `GroupView` change.

2 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/637-group-member-editing`** — one fix, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — **Slice 1 (core + api + sdk)** ships the read endpoint, its service method + response contract, and the `sdk.groups.members` query; nothing consumes the query yet, so it's self-contained (no forward dep). **Slice 2 (web)** consumes the query to fetch-seed the dialog and unifies the save path.

---

## Slice 1 — the org-membership-gated members read

`GET /api/groups/:id/members` → `{ userIds }`, backed by `GroupService.listMembers`, with the `sdk.groups.members` query ready for the FE.

**Files**

- Edit: `packages/core/src/contracts/rbac-authoring.contract.ts` — `GroupMembersResponseSchema` + type (beside `GroupMembersSetRequestSchema`).
- Edit: `apps/api/src/services/group.service.ts` — `listMembers(caller, id)`: `load` (org-scope) + `userGroups.findUserIdsByGroup`; **no authoring gate**.
- Edit: `apps/api/src/routes/group.router.ts` — `GET /:id/members` (`getApplicationMetadata`) + `@openapi`; `apps/api/src/config/swagger.config.ts` — register `GroupMembersResponse`.
- Edit: `apps/web/src/api/keys.ts` — `groups.members(id)` key; `apps/web/src/api/groups.api.ts` — the `members` query.
- Edit: `packages/core/src/__tests__/contracts/rbac-authoring.contract.test.ts` — the core case.
- Edit: `apps/api/src/__tests__/__integration__/routes/group.router.integration.test.ts` — the 3 api cases.

**Steps**

1. **Tests (spec: core + api cases).** Core: `GroupMembersResponseSchema` accepts `{ userIds:[…] }` / `{ userIds:[] }`, rejects missing `userIds`. Integration: a 2-member group → `{ userIds:[…2…] }`; empty group → `{ userIds:[] }`; a **cross-org** group id → **404**; a plain **member** (no `member.role.assign`) → **200** (the members-read gate). Run; fail (route absent).
2. **Implement** the schema, `listMembers`, the route + swagger component, the query key + `sdk.groups.members`. Green.
3. Lint + type-check (`packages/core`, `apps/api`; `apps/web` for the sdk/key edit).

**Done when:** core case + the 3 api cases pass; `GET /api/groups/:id/members` returns `{ userIds }`, 404s cross-org, and a plain member can read it; `sdk.groups.members` compiles (unused until slice 2).

**Risk:** route ordering — `/:id/members` must resolve distinctly from `/:id` (it does; two path segments). Low.

---

## Slice 2 — dialog fetch-seeds + saves membership

`GroupEditorDialog` fetches the group's members on edit-open, seeds the Members field, and persists on both create and edit.

**Files**

- Edit: `apps/web/src/modules/AccessAuthoring/GroupEditorDialog.component.tsx` — `sdk.groups.members(group?.id ?? "", { enabled: open && !!group })`; seed `memberIds` from `data.userIds` once per open (a `seededRef` reset in the open-effect); `handleSubmit` calls `sdk.groups.setMembers` on **both** create and edit.
- New: `apps/web/src/__tests__/GroupEditorDialog.test.tsx` — container-level test (SDK-mocked via `jest.unstable_mockModule`, `test-utils` `queryClient`). The [Component File Policy] container-wiring exception — the wiring is the point.

**Steps**

1. **Tests (spec: web cases).** (a) `sdk.groups.members` mocked `{ userIds:["u-1"] }` + a matching member option → edit-open shows the seeded member (not empty); (b) submit on an existing group calls `sdk.groups.setMembers` with `{ id: group.id, userIds }`; (c) submit on `group={null}` calls `setMembers` with the created id + ids (unified-path regression). Run; fail.
2. **Implement** the fetch-seed + unified submit. Green. (Members field is the **sync** `MultiSearchableSelect`, which renders selected chips from `options` — no seeded-value gap.)
3. Lint + type-check (`apps/web`).

**Done when:** the 3 web cases pass; re-opening a group shows its members and editing persists them; create still persists.

**Risk:** seed-once-per-open ref + SDK-mock wiring in the new test. Low.

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `GET /:id/members` + `listMembers` + response contract + `sdk.groups.members` | core (1) + api integration (3) |
| 2 | dialog fetch-seed + unified `setMembers` | web container test (3) |

## Cross-slice notes

- **No `GroupView` change → no fixture ripple.** Decision B leaves `GroupView` untouched, so — unlike the field approach — there's no required-field ripple to typed `GroupView` mocks in web/site. Simpler + safer.
- **Gate is deliberately lighter than group authoring:** the members read is org-membership-gated (`getApplicationMetadata` + org-scoped `load`), mirroring `SeatService.listMembers`; `GET /:id` stays authoring-gated. The api slice asserts both the cross-org 404 and the plain-member 200.
- **Swagger:** register `GroupMembersResponse` in `swagger.config.ts` so the `@openapi` `$ref` resolves (API style guide — no inline shape).
- **Cache:** `sdk.groups.members` is keyed per group + `enabled`-gated to edit-open, so it refetches on next open; the existing `queryKeys.groups.root` invalidation after `setMembers` still refreshes the list.
- **Doc-sync:** none — no user-facing copy, README, or CLAUDE.md change (internal dialog + additive endpoint).
- **Review chain:** Bug (full) → code-review + smoke required. **Security required** (not waived): this adds a new data-access endpoint with a deliberate gate + multi-tenant scope decision — exactly the "auth / data access / multi-tenancy" trigger. The adversarial pass probes the gate (cross-org id → 404, non-member/non-author read, hostile group id).

## Next step

Implementation begins on `fix/637-group-member-editing`, slice 1 first (tests-first), one commit per slice — only after discovery/spec/plan are reviewed and confirmed.
