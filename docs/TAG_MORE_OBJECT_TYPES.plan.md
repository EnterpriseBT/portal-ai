# Tagging stations, pins, connectors and views — Plan

**This plan implements object tagging test-first: the schema, a shared `TagAssignmentService` and route factory, four new assignment mounts, list `tagIds`/`include=tags`, tombstone sweeps, readable usage counts, shared web tag components and the four views, then docs.**

Spec: `docs/TAG_MORE_OBJECT_TYPES.spec.md`. Discovery: `docs/TAG_MORE_OBJECT_TYPES.discovery.md`. Issue: #1070. #1071 (the Tags toolpack) builds on slice 3's service.

Nine slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/1070-tag-more-object-types`**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package, narrowed with `--testPathPattern` (never invoke jest directly):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration -- --testPathPattern <pattern>
cd apps/web && npm run test:unit -- --testPathPattern <pattern>
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary (after a core change, a full root `npm run build`, since core fields ripple into web/site fixtures); (5) next slice.

Sequencing rationale. Storage comes first, then the backend path the entity routes already use, generalised with no behaviour change, then the new surface, then the web:

- **Slice 1** — schema, migration and core model: a type change that every later slice reads.
- **Slice 2** — repository generalised by `TagTargetType`, with every existing entity caller moved over in the same slice so nothing references a removed method.
- **Slice 3** — `TagAssignmentService` + router factory, with the entity routes moved onto it (same URLs, plus the race-safe 409). **#1071 can start its discovery against this service after this slice.**
- **Slice 4** — the four new mounts + route map + OpenAPI.
- **Slice 5** — list `tagIds`/`include=tags` × 4, plus the entity readable-tags fix.
- **Slice 6** — tombstone sweeps.
- **Slice 7** — usage counts (API + contract).
- **Slice 8** — web SDK, keys, invalidation and shared components, with EntityDetail and Entities refactored onto them (the old SDK module is deleted here).
- **Slice 9** — the four list/detail views, the Tags page counts and `DeleteTagDialog`.
- **Slice 10** — docs copy (glossary rename and its web route key, FAQ, troubleshooting, empty-list help).

(That's ten slices. The spec estimated about nine, and the web split into 8/9 keeps each commit reviewable.)

---

## Slice 1 — Schema, migration, core model

Assignments can point at any of the five target types. No code writes the new columns yet.

**Files**

- New: `packages/core/src/models/tag-target.model.ts`: `TagTargetTypeSchema`, `TagTargetSchema`, `TAG_TARGET_PERMISSION_TYPE`, exported from the models barrel.
- Edit: `packages/core/src/models/entity-tag-assignment.model.ts`: nullable `connectorEntityId`, four new nullable ids, and the exactly-one refine.
- Edit: `apps/api/src/db/schema/entity-tag-assignments.table.ts`: the columns, the CHECK, four partial unique indexes, `entity_tag_assignments_tag_idx`, and the doc comment.
- Edit: `apps/api/src/db/schema/zod.ts`, `type-checks.ts`.
- New: `apps/api/drizzle/<n>_tag-assignment-targets.sql` + `meta/_journal.json` + snapshot (`npm run db:generate -- --name tag-assignment-targets`).

**Steps**

1. **Tests (spec: Core ≈ 3; Migration ≈ 2).**
   - **Core model tests:** a model with exactly one target is required, and zero or two targets are rejected. The permission map covers every target.
   - **API integration** (`entity-tag-assignment-schema.integration.test.ts`): an existing entity row is valid, and a raw insert with two targets fails the CHECK.
   - Run; fail.
2. **Implement** the model, the table and the generated migration. Read the SQL: it must be additive with no `DROP`, so `lint:migrations` passes. The entity-only call sites keep compiling because the select type only widens to `string | null`. Fix any call site the narrowing flags with `!` where the entity column is known set, until slice 2 replaces them.
3. `npm run lint:migrations`, lint, type-check, root build.

**Done when:** the model and CHECK tests pass, the migration applies cleanly on a fresh DB and on a DB with existing assignments, and the existing entity-tag suites are still green.

**Risk:** the drizzle-kit output for a partial unique index plus CHECK. Hand-check the SQL against the spec's Migration section.

---

## Slice 2 — Repository generalised by target type

**Files**

- Edit: `apps/api/src/db/repositories/entity-tag-assignments.repository.ts`: `targetColumn(type)`, `findByTarget`, `findByTargetIds`, `insertIfAbsent`, `findAssignment`, `softDeleteByTargets`, `countByTargetIds` and `taggedWithAny`. Remove `findByConnectorEntityId`, `findByConnectorEntityIds`, `findExisting`, `softDeleteByConnectorEntityIds` and `countByConnectorEntityIds`.
- Edit the callers:
  - `connector-entities.repository.ts:96-125` (include);
  - `connector-entity.router.ts:195-213` (the `tagIds` subquery → `taggedWithAny("entity", …)`);
  - `connector-entity-validation.service.ts:134`;
  - `connector-instance.router.ts:561,1516`;
  - `entity-tag-assignment.router.ts` (still alive until slice 3).
- New: `apps/api/src/__tests__/__integration__/db/repositories/entity-tag-assignments.repository.integration.test.ts`.

**Steps**

1. **Tests.** For each of the five types:
   - `insertIfAbsent` returns `created: true` and then `created: false`, and two concurrent calls make one row.
   - `findByTargetIds` batches in one query.
   - `softDeleteByTargets` only touches its type.
   - `taggedWithAny` matches any of the ids.
   - Run; fail.
2. **Implement**, then move the callers over. The existing entity-tag, connector-entity and connector-instance suites must stay green unchanged, which proves no behaviour change.
3. Lint + type-check.

**Done when:** the repository suite passes and every pre-existing tag-related suite is green.

**Risk:** the `ON CONFLICT … WHERE deleted IS NULL` target. Postgres matches a partial index only when the conflict clause restates its predicate.

---

## Slice 3 — `TagAssignmentService` + router factory (entity moved onto it)

**Files**

- New: `apps/api/src/services/tag-assignment.service.ts`.
- New: `apps/api/src/routes/tag-assignment.router.ts`: `createTagAssignmentRouter(type)` with a descriptor per type (row loader, `notFound`).
- Edit: `connector-entity.router.ts:60-63`: mount the factory for `"entity"`.
- Delete: `apps/api/src/routes/entity-tag-assignment.router.ts`.
- New: `apps/api/src/__tests__/__integration__/routes/tag-assignment.router.integration.test.ts`, table-driven over types, with only `entity` in the table in this slice.

**Steps**

1. **Tests (spec: assignment router, the 12 cases, run for `entity`).** These include concurrent POSTs giving one 201 and one 409 (today's code gives a 500). Run; the concurrency case fails.
2. **Implement** the service and factory, and re-point the entity mount. Move or delete the old router's tests into the new table-driven file, diffing test names so nothing is silently dropped. Green.
3. Lint + type-check, plus the route-authorization guard test (the entity entries are unchanged).

**Done when:** all 12 entity cases pass at the same URLs and the route-map guard is green.

**Risk:** losing test coverage when the old router's suite is deleted. Diff the `it(` names before and after.

---

## Slice 4 — Assignment routes for stations, pins, connectors, views

**Files**

- Edit: `tag-assignment.router.ts`: descriptors for `station`, `pin`, `connector_instance` and `curated_view`.
- Edit: `station.router.ts`, `portal-results.router.ts`, `connector-instance.router.ts`, `curated-view.router.ts`: mount `createTagAssignmentRouter(type)` at `/:targetId/tags`.
- Edit: `apps/api/src/__tests__/config/route-authorization.map.ts`: 12 entries with `locks: { none: … }`.
- Edit: `apps/api/src/config/swagger.config.ts` + the `@openapi` blocks.
- Edit: the integration test table, adding the four types.

**Steps**

1. **Tests.** Extend the type table, which gives 48 new cases, including a read-only caller getting 403 and a foreign-org target getting 404 for each type. One case tags a connector instance while a sync job row is `active`, and expects a 201. Run; fail (404, since nothing is mounted).
2. **Implement** the descriptors and mounts, the route map and the OpenAPI blocks. Green. The guard catches any path-param naming mismatch.
3. Lint + type-check.

**Done when:** 60 router cases pass and the route-map and OpenAPI guards are green.

**Risk:** the express mount order, since a `/:id` route registered before `/:targetId/tags` can shadow it. Mount the factory first in each router.

---

## Slice 5 — List `tagIds` + `include=tags`

**Files**

- Edit, core: `station.contract.ts`, `portal.contract.ts`, `connector-instance.contract.ts`, `curated-view.contract.ts` (`tagIds`, and `…WithTags` row schemas).
- Edit, API:
  - `station-query.service.ts` / `station.router.ts:391`;
  - `portal-results.router.ts:452`;
  - `connector-instance.router.ts:155`;
  - `curated-view.service.ts` / `curated-view.router.ts:77`;
  - `connector-entity.router.ts` and `connector-entities.repository.ts` (the readable-tags fix + `tagIds` intersection).
- Edit: `tag-assignment.service.ts`: `readableTagFilter`.
- New: `apps/api/src/__tests__/__integration__/routes/tag-list-filter.integration.test.ts`.

**Steps**

1. **Tests (spec: list filter, about 25, table-driven over five list endpoints).** Core contract tests for `tagIds`. Run; fail.
2. **Implement** each list in turn, re-running its rows. Green.
3. Lint + type-check + root build (core row schemas changed).

**Done when:** all 25 cases pass, including "unreadable tag id → empty page" and "include omits unreadable tags" on entities.

**Risk:** `count` disagreeing with the rows. Each test asserts `total` alongside the ids.

---

## Slice 6 — Tombstone sweeps

**Files**

- Edit:
  - `station.router.ts:1106-1215`;
  - `portal-results.router.ts:801-827` (wrap the soft-delete and the sweep in one tx);
  - `connector-instance.router.ts:1429-1550` (the instance's own assignments);
  - `curated-view-delete.service.ts:44-100`.
- New: `apps/api/src/__tests__/__integration__/services/tag-tombstone.integration.test.ts`.

**Steps**

1. **Tests (spec: tombstone, about 8):**
   - each type's delete sweeps its assignments;
   - connector delete sweeps instance, entity and view assignments;
   - station delete leaves its pins' tags;
   - tag delete clears all five types.
   - Run; fail.
2. **Implement** one `softDeleteByTargets` call per path, inside its existing transaction. Green.
3. Lint + type-check.

**Done when:** all eight cases pass.

**Risk:** none beyond keeping each sweep inside its path's own `tx`.

---

## Slice 7 — Tag usage counts

**Files**

- Edit, core: `entity-tag.contract.ts`: `include` on the list query. `EntityTagWithUsageSchema` replaces `EntityTagWithAssignmentCountSchema`, and the list row gets optional `usage`.
- Edit, API: `entity-tag.router.ts:93-170`, plus a `countUsageByTag(set, tagIds, type)` helper on the repository, one grouped query per type through `visibilityPredicate`.
- Edit: `entity-tag.router.integration.test.ts`.

**Steps**

1. **Tests (spec: about 4):**
   - per-type counts are right;
   - an object the caller can't read isn't counted;
   - a tombstoned object isn't counted;
   - an unused tag gives all zeros;
   - without `include` there's no `usage` key.
   - Run; fail.
2. **Implement.** Green.
3. Lint + type-check + root build.

**Done when:** the four cases pass, and nothing references the removed schema.

**Risk:** query cost. Record a timing against the seeded org during smoke.

---

## Slice 8 — Web SDK + shared tag components (EntityDetail/Entities moved over)

**Files**

- New: `apps/web/src/api/tag-assignments.api.ts`; delete `entity-tag-assignments.api.ts`. Edit `api/sdk.ts` and `api/keys.ts` (`tagAssignments`).
- New: `apps/web/src/utils/tag-invalidation.util.ts`; edit `delete-invalidation.util.ts` (add `tagAssignments.root`).
- New components: `TagChip`, `TagChipList`, `TagAssignSelect` and `TagsSection` (each `*.component.tsx` with its test and story).
- Edit: `EntityDetail.view.tsx` (the local `TagAssignSelect` and section → `<TagsSection target={{type:"entity", id}}>`), `Entities.view.tsx` (→ `TagChipListUI`), `Tags.view.tsx` (update/delete invalidate `tagCatalogChangeKeys()`).

**Steps**

1. **Tests (spec: web components ≈ 12, invalidation ≈ 4).**
   - `TagsSectionUI`: an allow gate shows the select and deletable chips. A hide gate shows read-only chips. Hide with no tags renders nothing. Assign and unassign fire their callbacks.
   - `TagChipListUI` renders nothing for an empty list.
   - Axe on each component.
   - Key helpers.
   - The existing EntityDetail and Entities tests are updated, not deleted.
   - Run; fail.
2. **Implement.** Green. The component-axe, mutation-invalidate, permission-denied-invalidation and action-gate guards must pass.
3. Lint + type-check.

**Done when:** the new component tests pass and the EntityDetail and Entities behaviour is unchanged.

**Risk:** partial module mocks of `api.util` in web tests break when a module gains exports. Add the new names to those mocks.

---

## Slice 9 — Four views + Tags page counts

**Files**

- Edit, views:
  - `Stations.view.tsx` + `StationList.component.tsx`, `StationDetail.view.tsx`;
  - `PinnedResultsListView.view.tsx` + `PinnedResultsList.component.tsx`, `PinnedResultDetail.view.tsx`;
  - `Connector.view.tsx` + `ConnectorInstance.component.tsx`, `ConnectorInstance.view.tsx`;
  - `CuratedViews.view.tsx`, `CuratedViewDetail.view.tsx`.
- Edit, Tags page: `TagCard.component.tsx` (`usage` line), `Tags.view.tsx` (`include: "usage"`), `DeleteTagDialog.component.tsx` copy.

**Steps**

1. **Tests (spec: list views ≈ 8, Tags page ≈ 3):**
   - each list has the Tags filter, and `tagIds` reaches `queryParams`;
   - each card shows a tag row, or none when there are no tags;
   - each detail renders `TagsSection` gated on `capabilities.write`;
   - `TagCardUI` shows "4 entities · 2 views" and "Not used";
   - the `DeleteTagDialog` copy.
   - Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** the cases pass, and each view's existing suite is green.

**Risk:** card layouts. Check them during smoke at phone width.

---

## Slice 10 — Docs copy

**Files**

- Edit, core content: `glossary.util.ts` ("Entity Tag" → "Tag"), `faq.util.ts`, `troubleshooting.util.ts` (new "I can't add or remove a tag" entry).
- Edit, web: `glossary-routes.util.ts:38`, `empty-list-help.util.ts`, plus any `relatedGlossaryTerms` reference.

**Steps**

1. **Tests:** update the glossary and FAQ pins and the glossary-routes test (the renamed key keeps its Help link). Help findability covers the new troubleshooting entry automatically, so add an alias if it doesn't rank first. Run the permission-copy guards. Run; fail.
2. **Implement.** Green.
3. Lint + type-check + root build.

**Done when:** the content and guard suites pass across core, web and site.

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | schema + migration + core model | ≈ 5 | core unit, api integration |
| 2 | repository by target type | ≈ 10 | api integration |
| 3 | service + factory, entity moved | 12 | api integration |
| 4 | four new mounts + route map + OpenAPI | 48 | api integration + guards |
| 5 | list `tagIds` / `include=tags` | ≈ 25 | api integration, core unit |
| 6 | tombstone sweeps | ≈ 8 | api integration |
| 7 | usage counts | ≈ 4 | api integration |
| 8 | SDK + shared components, entity UI moved | ≈ 16 | web unit + guards |
| 9 | four views + Tags page | ≈ 11 | web unit |
| 10 | docs copy | ≈ 4 | core/web unit + guards |

Total ≈ **143 cases** (the spec's ≈ 134, plus the repository suite). There's one migration, in slice 1.

## Cross-slice notes

- **Migration ordering:** slice 1 only. Commit the `.sql`, `_journal.json` and snapshot together.
- **Removing names cleanly:** slices 2, 3 and 8 delete the entity-specific repository methods, router and SDK module outright, with no aliases. Each slice moves every caller in the same commit.
- **Core changes ripple:** slices 1, 5, 7 and 10 change core. Run the full root build before pushing each one.
- **Invalidation:** assign and unassign refresh the target type's `.root` because list rows carry tags. A tag update or delete refreshes all five types (slice 8). Both go through the call's `invalidate` option, never `onSuccess`.
- **Gating:** detail editing renders through `GatedButton`/`gate`, never `disabled={!canWrite}` (the action-gate guard).
- **Docs in sync:** slice 10 covers the glossary, FAQ, troubleshooting and help. `CUSTOM_TOOLPACK_INTEGRATION.md`, the tool surfaces and the system prompt are untouched (agent tools are #1071).

## Next step

Implementation begins on this branch with slice 1, tests first, one commit per slice, once this plan is confirmed.
