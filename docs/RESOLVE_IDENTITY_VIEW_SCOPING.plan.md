# resolve_identity view scoping — Plan

**A TDD-sequenced fix for the identity-resolution bypass, in five slices:**
1. #651's link-column group scoping.
2. A view-scoped row helper in `PortalSqlService`, with the filter render extracted.
3. `resolve_identity` rewired through the caller's granted views: result shape, registration and copy.
4. The REST `/resolve` RBAC predicate.
5. The read-scoping recurrence guard.

Spec: `docs/RESOLVE_IDENTITY_VIEW_SCOPING.spec.md`. Discovery: `docs/RESOLVE_IDENTITY_VIEW_SCOPING.discovery.md`. Folded-in design: `docs/ENTITY_GROUP_LINK_COLUMN_SCOPE.condensed.md`. Issues: #658 + #651 (epic #578).

This builds on shipped work, all live on `main`:
- #599: `resolveGrantedViewColumns`, `queryCuratedViewRecords`, the `visibilityPredicate("entity_record")` precedent;
- #648: `scopeEntityGroupsToEntities`;
- #629: the tool-authorization guard tests.

The five slices each sit behind a green test suite and each leave the repo compilable. They land as **commits on `fix/658-resolve-identity-view-scoping`**: one PR that `Closes #658` and `Closes #651` (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit -- --testPathPattern <file>
cd apps/api && npm run test:integration -- --testPathPattern <file>
cd packages/core && npm run test:unit -- --testPathPattern builtin-toolpacks
```

Each slice: (1) write failing tests; (2) make the smallest change to green them; (3) do a focused run; (4) run `npm run lint && npm run type-check` at the boundary; (5) move to the next slice.

Sequencing rationale: leaf logic first, then the read primitive, then the wiring that uses both, then the independent REST route, and last the guard that is only truthful once the wiring exists.

- **Slice 1** is the pure group-scoping rule. `resolve_identity` (slice 3) and the display both depend on it. It also closes #651's acceptance on its own.
- **Slice 2** is the scoped read primitive, tested directly against the DB. Nothing calls it yet.
- **Slice 3** composes 1 and 2 into the tool. This is where the repro becomes a regression test, and where the agent-facing copy changes, pinned in the same commit.
- **Slice 4** is the REST twin. It has no dependency on 1–3 (a different predicate) and is sequenced here only so the agent-facing fix lands first.
- **Slice 5** is the guard. Its `READ_SCOPING` row for `resolve_identity` (`view-helper`) is only true after slice 3.

There is no migration and no seed.

---

## Slice 1 — group scoping requires a readable link column (#651)

`scopeEntityGroupsToEntities` keeps a group only when every member's entity is granted **and** some granted view over that entity can read the member's link column.

**Files**

- Edit: `apps/api/src/utils/entity-group-scope.util.ts`. `GrantedViewRef` gains `columns: ReadonlyArray<{ normalizedKey: string }>`. Build `Map<entityId, Set<normalizedKey>>` as the union over that entity's views. Drop the `NOTE (#651)` and update the doc comment.
- Edit: `apps/api/src/__tests__/utils/entity-group-scope.util.test.ts`, adding cases 1–3 and updating the fixtures of the existing #648 cases (case 4) to carry `columns`.
- Edit: `apps/api/src/__tests__/tools/station-context.tool.test.ts`, adding case 27.

**Steps**

1. **Tests (spec cases 1–4, 27).**
   - The link column is projected out, so the group is dropped.
   - A union across two views keeps it.
   - A readable non-link column doesn't count.
   - The #648 cases stay green.
   - `station_context` for a member whose view excludes the join column yields no `entityGroups` entry.

   Run; fail.
2. **Implement** the union-set check. Both call sites (`portal.service.ts:1265`, `station-context.tool.ts:360`) already pass `{ view, columns }`, so there is no call-site edit. Green.
3. Lint + type-check.

**Done when:** cases 1–4 and 27 pass; the roster and `station_context` drop groups whose link column the caller can't read.

**Risk:** low. Fixtures in other suites that build `GrantedViewRef` literals without `columns` fail to compile. Type-check catches them, so fix them in this slice.

---

## Slice 2 — `PortalSqlService.queryViewRowsByColumn` (+ `renderViewFilterWhere`)

This adds the scoped read primitive and extracts the duplicated view-filter render so three readers share one implementation.

**Files**

- Edit: `apps/api/src/services/portal-sql.service.ts`.
  - Add a private `renderViewFilterWhere(view, client): Promise<string | null>`, used by `buildViewsForSession` (`:602-620`) and `queryCuratedViewRecords` (`:447-462`). The latter keeps its `CURATED_VIEW_INVALID_FILTER` code.
  - Add a public `queryViewRowsByColumn(resolved, organizationId, match, opts, client?)` per the spec: a `null` return when the match column is unreadable, and `LIMIT limit + 1` producing `truncated`.
- Edit: `apps/api/src/__tests__/__integration__/services/portal-sql.service.integration.test.ts`, adding cases 5–10.

**Steps**

1. **Tests (spec cases 5–10).**
   - Only `_record_id`, `source_id` and the readable `c_*` columns come back.
   - The view filter applies.
   - An unreadable match column returns `null`.
   - `limit` produces `truncated`, ordered by `_record_id`.
   - The org guard and soft-delete exclusion apply.
   - A hostile literal matches nothing.

   Run; fail.
2. **Implement** the extraction first. The existing portal-sql integration suite must stay green, which proves the refactor is behaviour-preserving. Then add the helper. Green.
3. Lint + type-check.

**Done when:** cases 5–10 pass and every pre-existing `portal-sql` / curated-view-records test is unchanged and green. The helper is not yet called from production code.

**Risk:** the extraction touches the SQL session build that every `sql_query` uses. Mitigation: run the full `portal-sql.service.integration`, `portal-sql-view-memo` and curated-view records suites before committing, not just the new cases.

---

## Slice 3 — `resolve_identity` through granted views (repro → regression)

This rewires the tool: per-call resolution, the scoped group lookup, one match per member-view, `viewKey`/`truncated`, scoped registration, and the updated copy.

**Files**

- Edit: `apps/api/src/services/analytics.service.ts`: the new `resolveIdentity` params and `ResolveIdentityResult`, plus `RESOLVE_IDENTITY_MATCH_LIMIT = 100`. `fetchProjectedRows` is removed from this path.
- Edit: `apps/api/src/tools/resolve-identity.tool.ts`: `build(stationId, organizationId, userId, entityGroups)` plus the new `description`.
- Edit: `apps/api/src/services/tools.service.ts:595`: resolve the granted views and register only when the scoped groups are non-empty.
- Edit: `packages/core/src/registries/builtin-toolpacks.ts:208`, the mirrored description.
- Edit: `apps/api/src/prompts/system.prompt.ts` (data_query section), adding the `viewKey`/`truncated` line.
- New: `apps/api/src/__tests__/__integration__/tools/resolve-identity-view-scoping.integration.test.ts`, seeded from the saved repro (scratchpad `repro-resolve-identity-view-bypass.integration.test.ts`), with its assertions inverted to the safe behaviour.
- Edit: `apps/api/src/__tests__/__integration__/services/analytics-resolve-identity.integration.test.ts`, moving its 3 cases to the new signature with an owner caller and full views.
- Edit: `apps/api/src/__tests__/services/tools.service.test.ts:415-502`, where the registration cases (22) follow the scoped count.
- Edit: `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts` (case 25) and `apps/api/src/__tests__/prompts/system.prompt.test.ts` (case 26).

**Steps**

1. **Tests (spec cases 11–18, 22, 25, 26, plus the 3 updated resolve-identity cases).**
   - The hidden column is absent, the ungranted entity has no match, and the row filter applies.
   - Two views produce two `viewKey`s.
   - A view without the link column is skipped, and the group is then "not found".
   - A revoked grant is gone on the next call.
   - An admin is unchanged.
   - The tool is not registered when no group is scoped.
   - The copy pins hold.

   Run; fail. The new integration file must fail on the **current** code for the leak cases, which confirms the repro still bites before the fix.
2. **Implement** the service, the tool, the registration and the copy. Rebuild core (`npm run build` in `packages/core`) before the api suites, because the builtin mirror is consumed from `dist`. Green.
3. Lint + type-check, then the **root** `npm run build`. The core registry text changes, so per `feedback_core_model_change_run_full_build` web and site consume core too.

**Done when:** cases 11–18, 22, 25 and 26 pass; the repro scenario returns no `name` and no `orders`; the three copy surfaces agree.

**Risk:** this is the only slice that changes the agent-facing contract (`c_*` record keys, per-view matches). Keep the description, the mirror and the prompt in this one commit so the pins never disagree across a boundary.

---

## Slice 4 — REST `/entity-groups/:id/resolve` honours `entity_record` visibility

This applies the #599 raw-record predicate to the route the record-detail page calls. The payload is unchanged.

**Files**

- Edit: `apps/api/src/routes/entity-group.router.ts:963-1075`. Load the set once (reuse the one from the `entity_group` gate) and AND `visibilityPredicate("entity_record", { createdByCol: entityRecords.createdBy, idCol: entityRecords.id })` into each member's `where`, as `entity-record.router.ts:269-279` does. Add the `@openapi` 200 description line.
- Edit: `apps/api/src/__tests__/__integration__/routes/entity-group.router.integration.test.ts`, adding cases 19–21.

**Steps**

1. **Tests (spec cases 19–21).**
   - A custom role with `read entity_group` but no `read entity_record` gets 200 with `records: []`.
   - A `created_by_caller` role sees only its own records.
   - An owner sees everything, unchanged.

   Run; fail on case 19 or 20.
2. **Implement** the predicate. Green.
3. Lint + type-check.

**Done when:** cases 19–21 pass and the existing entity-group router cases are green.

**Risk:** low. The only behaviour change is for custom roles, which lose records they never should have had. No web change is needed; empty results already render as "no matches" (`EntityRecordDetail.view.tsx:84-90`).

---

## Slice 5 — read-scoping recurrence guard

This makes a future raw reader fail CI until someone classifies it.

**Files**

- Edit: `apps/api/src/__tests__/services/tools.service.test.ts`. Add a new `describe` beside the #629 guard (`:873`) with the local `READ_SCOPING` table from the spec (12 tools, 5 classes, each with its reason).

**Steps**

1. **Tests (spec cases 23–24).**
   - Every `ALL_TOOL_CAPABILITIES` entry with `reads` including `"entity_records"` is classified.
   - The table has no stale keys.

   To prove the guard bites, temporarily drop one row locally, confirm it fails, and restore the row. Do not commit the broken state.
2. There is no implementation; the guard is the deliverable. Green.
3. Lint + type-check.

**Done when:** cases 23–24 pass against today's 12 readers.

**Risk:** none (test-only). If a pack adds a reader in parallel before merge, the guard forces classifying it, which is exactly its job.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | #651 group scoping | cases 1–4, 27; type-check (fixture literals) |
| 2 | `queryViewRowsByColumn` + filter-render extraction | cases 5–10 + full portal-sql suites unchanged |
| 3 | `resolve_identity` rewire + registration + copy | cases 11–18, 22, 25, 26 + 3 updated; root build |
| 4 | REST predicate | cases 19–21 |
| 5 | recurrence guard | cases 23–24 (proven to bite) |

## Cross-slice notes

- **Doc sync (same PR).**
  - The agent-facing contract changes in slice 3: the tool `description`, the `builtin-toolpacks.ts` mirror and the `system.prompt.ts` guidance, all pinned.
  - Check `packages/core/src/content/glossary.util.ts` / `faq.util.ts` for any "Entity Group" / identity-resolution copy that promises cross-entity matches regardless of access, and adjust it if present.
  - No `CLAUDE.md`, README or `DEPLOYMENT_SECURITY_REVIEW.md` change is expected: no egress, and no convention change beyond the guard, which lives in a test.
- **The saved repro** is in the session scratchpad, not the repo. Slice 3 copies it into `__integration__/tools/` and flips the assertions; it is never committed in its "leak passes" form.
- **Core rebuild.** Slices 3 and 5 read core's registries from `dist`. Rebuild `packages/core` before running api suites after any core edit.
- **Review chain.** This is a full Bug touching data access, so every phase is required: code-review, security, smoke and adversarial. The adversarial doc should probe hostile link values, a revoked grant mid-session, multi-view entities, and the REST custom-role path.

## Next step

Once discovery, spec and plan are confirmed, implementation begins on `fix/658-resolve-identity-view-scoping` with slice 1, tests first, one commit per slice. Push the branch and open the draft PR (`Closes #658`, `Closes #651`) with the first implementation commit.
