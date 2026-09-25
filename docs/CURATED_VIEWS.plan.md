# Curated views (per-user data exposure) — Plan

**Implements the curated-views read/exposure layer as eight TDD-sequenced slices: the data layer, the condition engine, the per-user session cutover, the SQL-filter validator, the CRUD API, sharing/composition, the Views UI, and the `station_instances` teardown.**

Spec: `docs/CURATED_VIEWS.spec.md`. Discovery: `docs/CURATED_VIEWS.discovery.md`. Issue: #599 (epic #578). Builds on shipped #598/#620/#621/#622 (RBAC engine + grants + sharing), #629 (per-caller tool gate), #630 (role-gated nav). Splits: #640 (pins), #641 (ownership).

8 slices, each behind a green suite and each leaving the repo compilable. They land as **commits on `feat/599-curated-views`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale.** (1) is the additive leaf data layer — creates the tables and generates the cutover data while the old read path keeps working, so it changes no behavior. (2) is pure engine logic (resolver-preserving) that needs (1)'s join table to expand against. (3) is the read cutover — the behavior-changing slice — and needs (1)'s `station_views` + (2)'s field-grant expansion. (4) is a pure leaf validator placed just before its only consumer, (5) the CRUD API (which also needs (1)+(2)). (6) sharing needs views to exist (5) and the FK condition (2) to compose. (7) UI needs the CRUD API (5) + widened share (6). (8) tears down `station_instances` only after (3) stopped reading it and (7) replaced its UI. No forward dependencies.

---

## Slice 1 — Schema, models, repos + additive cutover migration

The three tables, their dual-schema models + repos, and an **additive** migration that creates them and generates one default (unrestricted) view + `station_views` row per currently-attached entity. Purely additive: `station_instances` still drives reads, so behavior is unchanged.

**Files**

- New: `packages/core/src/models/{curated-view,curated-view-field-mapping,station-view}.model.ts` (+ `models/index.ts` exports) — spec §2.
- New: `apps/api/src/db/schema/{curated-views,curated-view-field-mappings,station-views}.table.ts` (+ `schema/index.ts`) — spec §1.
- Edit: `apps/api/src/db/schema/{zod,type-checks}.ts` — Select/Insert pairs + 3-assertion `IsAssignable` block per table.
- New: `apps/api/src/db/repositories/{curated-views,curated-view-field-mappings,station-views}.repository.ts` (+ index + `DbService.repository` wiring).
- New: `apps/api/drizzle/<n>_curated-views-and-station-views.sql` (+ `meta/_journal.json` + `<n>_snapshot.json` — commit all three, `project_drizzle_journal_must_be_committed`) — spec §Migration steps 1 + 3 (create tables; `-- backfill:` default-view + `station_views` generation, `ON CONFLICT … DO NOTHING`, no grants). **Does not** retire `station_instances` (that is slice 8).

**Steps**

1. **Tests.** Core: `models/__tests__/curated-view.model.test.ts` (+ two join models) — schema accept/reject, factory stamps id/`createdBy` (spec test-plan core ≈12). API unit: repo CRUD + org-scoped `findMany`. API integration: `__integration__/db/migrate-default-views.integration.test.ts` — backfill generates default (unrestricted) views + `station_views`, idempotent, **no grants**, and the existing `buildSessionViews` read path is unchanged. Run; fail.
2. **Implement** the tables/models/zod/type-checks/repos + the additive migration. Green.
3. Lint + type-check (the `type-checks.ts` block is the drift gate).

**Done when:** the three tables exist with dual-schema parity; the migration generates cutover data idempotently; nothing yet *reads* `station_views`; member read behavior is unchanged.

**Risk:** low — additive. Watch the partial-unique idiom (`.where(sql\`deleted IS NULL\`)`) on every unique index and the journal+snapshot commit.

---

## Slice 2 — Condition engine: `in_curated_view` + `conditionParam` + `loadSet` expansion + `isDenied`

The FK-condition vocabulary and its **load-time expansion**, plus the deny-only probe — the resolver stays untouched.

**Files**

- Edit: `packages/core/src/models/permission.model.ts` — `PERMISSION_CONDITIONS += "in_curated_view"`; `conditionParam` on `PermissionStatementSchema`/`PermissionGrantSchema` — spec §3.
- Edit: `apps/api/src/db/schema/{permission-grants,permission-statements}.table.ts` + `zod.ts`/`type-checks.ts` — `condition_param text` column.
- New: `apps/api/drizzle/<n>_fk-condition.sql` (+ journal + snapshot) — add `condition_param`; drop + re-add `*_condition_check` to allow `in_curated_view` (+ optional `(condition='in_curated_view') = (condition_param IS NOT NULL)`) — spec §Migration step 2 (a widening, `lint:migrations`-clean).
- Edit: `apps/api/src/services/permission.service.ts` — `expandFkConditions(raw, ctx, client)` called between grant-load and `new PermissionSet` (`:126`) — spec §4.
- Edit: `apps/api/src/services/permission-set.ts` — `isDenied(verb, resourceType, object?)` — spec §4.

**Steps**

1. **Tests.** `permission-set.test.ts`: `isDenied` true only on an explicit deny (not on no-allow); an **unexpanded** `in_curated_view` statement never matches (fails closed). `permission.service.test.ts`: `expandFkConditions` — a no-projection view → all entity fields; an explicit view → its join members; the original FK statement is dropped; a non-FK statement passes through. Integration `__integration__/services/rbac-fk-expansion.integration.test.ts`: a `read field_mapping in_curated_view:V` grant makes V's fields readable; adding a field mapping to V extends readability with no grant change (auto-tracking). (spec test-plan api-unit + integration.) Run; fail.
2. **Implement** the vocab + column + migration + expansion + `isDenied`. Green.
3. Lint + type-check.

**Done when:** a curated-view FK grant resolves to concrete `field_mapping` reads via `loadSet`; `isDenied` distinguishes explicit deny; `matches`/`visibilityPredicate` are byte-for-byte unchanged.

**Risk:** the CHECK-constraint migration — verify the drop/re-add names match (`permission_grants_condition_check`, `permission_statements_condition_check`) exactly.

---

## Slice 3 — Session engine + capability/context rederivation (the read cutover)

`resolveViewsForSession(stationId, userId)` replaces `buildSessionViews`, and the four data-shape surfaces + capability resolution switch from `station_instances` to `station_views`. **This is the behavior-changing slice** — after it, member reads are view-scoped and default-deny.

**Files**

- Edit: `apps/api/src/services/portal-sql.service.ts` — `buildSessionViews` → `resolveViewsForSession(stationId, userId, client)`: view set = `station_views(stationId)` ∩ readable `curated_view`s; per view emit effective projection (∩ field grants) + `whereClause`; suppress on `isDenied("read","entity_record")`; `_meta_*` per-view; `_meta_column_catalog` only when entity-management available — spec §5.
- Edit: `apps/api/src/utils/resolve-capabilities.util.ts` — `resolveStationCapabilities`/`resolveEntityCapabilities` source `station_views → view → entity → instance`.
- Edit: `apps/api/src/services/portal.service.ts` — `buildStationContext` gains `userId` (entities = resolved views); `loadConnectorInstanceContexts` derives instances from views; call sites `:395`/`:689` thread `userId`.
- Edit: `apps/api/src/tools/station-context.tool.ts` — per-view columns for members; `apps/api/src/tools/sql-query.tool.ts` / `services/tools.service.ts:583` pass `userId`.
- Edit: `apps/api/src/prompts/system.prompt.ts` — roster reads the resolved views (agent-guidance doc surface: keep `system.prompt.test.ts` green).

**Steps**

1. **Tests.** `portal-sql.service.test.ts`: `resolveViewsForSession` projects only granted columns, ANDs a non-null `whereClause`, suppresses a view under an `entity_record` deny, emits `_meta_*` per-view, and **fails closed with no user**. Integration `__integration__/services/curated-views-session.integration.test.ts`: two views (grants seeded directly — no ShareDialog yet) over one wide table → a member sees only granted views/columns across the query path, `_meta_*`, and `station_context`; an admin (`*`) sees all columns; capability + `buildStationContext` rederive from `station_views`. (spec test-plan.) Run; fail.
2. **Implement** the rewrite + rederivation + `userId` threading. Green.
3. Lint + type-check.

**Done when:** every member-facing data-shape surface is view-scoped and keyed off `station_views`; `buildSessionViews` is gone; admins retain full access via `*`.

**Risk:** **highest — the cutover.** Existing integration fixtures that assert a *member* sees data via `station_instances` will break; update them to seed a `curated_view` grant (or assert the new default-deny) in this slice. Admin/owner-principal tests are unaffected (they match `*`). No `whereClause` validation is needed yet (only null-filter default views exist until slice 5).

---

## Slice 4 — `whereClause` validator (the injection boundary)

A pure, leaf validator for the one free-SQL surface, with its adversarial cases.

**Files**

- New: `apps/api/src/services/curated-view-filter.validator.ts` — `validateWhereClause(clause, entity)` → throws `ApiError(400, CURATED_VIEW_INVALID_WHERE_CLAUSE)` — spec §8.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `CURATED_VIEW_INVALID_WHERE_CLAUSE`.
- (Plan-time decision, per the spec flag: confirm the existing LLM-SQL guard behind `runSqlQuery` validates a *fragment*; if not, add `pgsql-parser`/`libpg_query` as an `apps/api` dep — a dep bump reviewed on its own.)

**Steps**

1. **Tests.** `curated-view-filter.validator.test.ts`: accepts a bounded boolean predicate over `c_*` columns; rejects a subquery, a write/DDL, a foreign-table/column ref, a non-boolean expression, and a function outside the allow-list. These double as the **adversarial** probes for the injection boundary. Run; fail.
2. **Implement** the parser + allow-list. Green.
3. Lint + type-check.

**Done when:** any clause that is not a pure, entity-scoped boolean expression is rejected; validation is identical for human- and LLM-authored input.

**Risk:** the parser choice — if a new dep, keep it to the parser only; the allow-list lives in our code, not the parser.

---

## Slice 5 — Curated-view CRUD routes + records endpoint + self-exposure guard

The admin CRUD surface and the member-facing records endpoint, both server-authoritative.

**Files**

- New: `apps/api/src/routes/curated-view.router.ts` (+ app mount) — list (`visibilityPredicate("curated_view")`), create/patch/delete (per-object `check`), `POST /:id/attach` · `DELETE /:id/attach/:stationId`, `GET /:id/records` (keyset, projection ∩ field grants + `whereClause`) — spec §7.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — the `CURATED_VIEW_*` codes (spec §7).
- Edit: `apps/api/src/config/swagger.config.ts` — `CuratedView` component + `@openapi` refs.
- New: request/response contracts in `@portalai/core/contracts`.

**Steps**

1. **Tests.** `curated-view.router.test.ts` (unit, dialog/route checklist): CRUD, **self-exposure guard** (adding a non-readable `fieldMappingId` → 403 `CURATED_VIEW_FIELD_NOT_READABLE`; creating an unrestricted view requires read on *all* entity fields), records auth. Integration `__integration__/routes/curated-view.router.integration.test.ts`: CRUD, `GET /:id/records` (projection + filter + keyset), duplicate `key` → 409, self-exposure → 403. Run; fail.
2. **Implement** the router + codes + swagger + contracts (the validator from slice 4 runs on `whereClause`). Green.
3. Lint + type-check.

**Done when:** admins CRUD views over the API; the records endpoint serves view-scoped, keyset-paginated rows under the same authorization the session uses; the self-exposure guard holds.

**Risk:** the effective-projection guard must cover both the explicit-list and empty (= all fields) cases.

---

## Slice 6 — Sharing + composition

`curated_view` becomes shareable, and a share **composes** the field-mapping grant (view-share; station-share composition folded in, separable if this slice runs large).

**Files**

- Edit: `packages/core/src/models/permission.model.ts` — `SHAREABLE_RESOURCE_TYPES += "curated_view"`, `INSTANCE_SEARCHABLE_TYPES += "curated_view"` — spec §3.
- Edit: `apps/api/src/services/grant.service.ts` — `resolveObject` `curated_view` case; **view-share composition** (write `read curated_view:V` + one `read field_mapping in_curated_view:V` in the same txn); **station-share composition** (compose each `station_views(S)` view's grants).
- Edit: `@portalai/core/contracts` `ShareResourceType` → `station|pin|curated_view`.
- Edit: `apps/api/src/services/seed.service.ts` — no behavior change needed (the `SHAREABLE` loop now emits an inert member `share curated_view created_by_caller`); assert it in the seed test.

**Steps**

1. **Tests.** `grant.service.test.ts`: sharing `curated_view:V` writes the view grant **and** the composed FK field grant for the principal; boundary rejection when the granter lacks the field access; `team` grantee → member-role grant. Integration: a shared view (via the grant path) makes its columns readable in a member session (ties slices 2+3+6 together end-to-end). Run; fail.
2. **Implement** the SHAREABLE/INSTANCE_SEARCHABLE additions + `resolveObject` + composition. Green.
3. Lint + type-check.

**Done when:** sharing a view (or a station) composes independent, revocable grants; a shared view's columns resolve for the grantee; "whole org" reuses `team`.

**Risk:** station-share composition touches the station ShareDialog contract; if it bloats the slice, land view-share here and station-share as a 6b commit.

---

## Slice 7 — Views UI (nav page, detail/records, share, attach-view, marked chips)

The frontend: a member-visible Views page, the detail/records view with the LLM-assisted filter editor, the widened share dialog, and the station attach-view swap.

**Files**

- Edit: `packages/core/src/models/permission.model.ts` — `NAV_PAGE_IDS += "views"`, `MEMBER_VIEW_PAGE_IDS += "views"`; new `apps/api/drizzle/<n>_backfill-views-page-grant.sql` (+ journal + snapshot) — the #630 `0110` member `view page:views` backfill.
- New: `apps/web/src/api/curated-views.api.ts` + `queryKeys.curatedViews` (`api/keys.ts`) + `api/sdk.ts` registration.
- New: `apps/web/src/views/{CuratedViews,CuratedViewDetail}.view.tsx` (+ route wrapped in `guardedComponent("views")`), the create/edit dialog (field-mapping picker + LLM-assisted `whereClause` editor + sample preview via `GET /:id/records?preview`).
- Edit: `apps/web/src/components/SidebarNav.component.tsx` (forced `PAGE_NAV` entry), `components/ShareDialog.component.tsx` (`resourceType` widen), station-detail attach UI (attach-view; inaccessible views = red-overlay chips).

**Steps**

1. **Tests.** `apps/web` unit (Component File Policy — render the `*UI`): `CuratedViews.view` (card list, gated `Create`/share), `CuratedViewDetail` (records table, edit-dialog Zod validation + a11y per the Dialog checklist), `ShareDialog` widened to `curated_view`, marked inaccessible chips. Run; fail.
2. **Implement** the SDK slice + views + nav + dialog + backfill migration. Green.
3. Lint + type-check.

**Done when:** members see and browse their granted views; admins CRUD + share; stations attach views (connectors gone from station-detail); inaccessible attached views render marked.

**Risk:** `guardedComponent` + `NAV_PAGE_IDS` compile-forcing (a missing `PAGE_NAV` entry is a compile error — good); the LLM-assisted editor mirrors the RestApi TransformEditor shape.

---

## Slice 8 — Remove `station_instances` (teardown)

With reads and capability off `station_instances` (slice 3) and the UI on attach-view (slice 7), delete the dead attachment.

**Files**

- New: `apps/api/drizzle/<n>_drop-station-instances.sql` (+ journal + snapshot) — drop the table (now unreferenced). Destructive → carries `-- destructive-ok: station_instances superseded by station_views (#599)` per `lint:migrations`.
- Delete: `apps/api/src/db/schema/station-instances.table.ts`, its repo, zod/type-checks blocks, `StationInstance` model usages; any residual references.

**Steps**

1. **Tests.** Grep-guard / a compile pass proving no code references `stationInstances`; the existing capability/session integration suites (slice 3) stay green against `station_views` only. Run; fail (on lingering refs) → green.
2. **Implement** the drop + deletions. Green.
3. Lint + type-check.

**Done when:** `station_instances` is gone from schema + code; the full suite is green on the view-only attachment.

**Risk:** `lint:migrations` destructive-ok marker required; confirm no migration/seed elsewhere seeds `station_instances`.

---

## Sequence summary

| # | Lands | Gating check |
|---|---|---|
| 1 | 3 tables + models + repos + additive cutover migration | core + api-unit + migrate-default-views integration |
| 2 | `in_curated_view` + `conditionParam` + `loadSet` expansion + `isDenied` | permission-set/service unit + rbac-fk-expansion integration |
| 3 | `resolveViewsForSession` + capability/context rederivation (cutover) | portal-sql unit + curated-views-session integration |
| 4 | `whereClause` validator (+ adversarial) | validator unit |
| 5 | CRUD routes + records endpoint + self-exposure guard | router unit + integration |
| 6 | sharing + composition | grant.service unit + integration |
| 7 | Views UI + nav + share + attach-view + page backfill | apps/web unit |
| 8 | drop `station_instances` | grep-guard + green suites |

## Cross-slice notes

- **The cutover is slice 3.** It flips member reads to default-deny; update any member-principal integration fixture there (admin/owner fixtures are unaffected via `*`). Do not spread this across slices — it is one atomic behavior change behind `resolveViewsForSession`.
- **Migrations:** slices 1, 2, 7, 8 each generate a migration — commit the `.sql` **plus** `meta/_journal.json` **plus** the snapshot every time (`project_drizzle_journal_must_be_committed`). 1/2/7 are expand-only; 8 is the only destructive one (`-- destructive-ok:`).
- **Doc-sync (same PR, per `CLAUDE.md` → "Keeping Documentation in Sync"):** slice 3 updates `system.prompt.ts` (agent guidance) + the `station_context` tool description — keep `system.prompt.test.ts` / `builtin-toolpacks.test.ts` green; add the "gate records **with views, not RBAC directly**" best-practice to the developer docs. **User-facing Help/glossary/FAQ for views is deferred to the #615 documentation-alignment audit** (per discovery), not blocking here.
- **`conditionParam`** spans slices 2 (introduced) → 6 (written by share composition) → consumed by 2's expansion in every member session (3). It never carries a value until slice 6, so slices 2–5 tests seed it directly.
- **`_meta_column_catalog`** is gated to entity-management (admin) in slice 3 to avoid leaking the org catalog to member sessions.

## Next step

Implementation begins on `feat/599-curated-views`, **slice 1 first, tests-first, one commit per slice** — only after discovery + spec + this plan are reviewed and confirmed.
