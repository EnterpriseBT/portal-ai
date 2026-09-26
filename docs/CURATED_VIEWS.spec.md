# Curated views (per-user data exposure) — Spec

Pins the contract for [#599](https://github.com/EnterpriseBT/portal-ai/issues/599), from `docs/CURATED_VIEWS.discovery.md`. Curated views become the sole member data-read path: a per-user session-view engine over admin-curated slices (row filter + column projection), field-mapping-level access control, sharing-first grants, and a Views UI — with `station_views` **replacing** `station_instances` as a station's data attachment (everything is a view).

## Key decisions (confirm captured correctly)

1. **Read = composition, deny-always-wins.** Data through view `V` = rows (`whereClause` − explicit `deny entity_record`) × columns (projection ∩ `read field_mapping`), gated by `read curated_view:V`. The resolver is unchanged; deny already wins in `permission-set.ts:350`.
2. **FK condition via `loadSet` expansion, not a resolver change.** A new `in_curated_view` condition (param = a view id) is **expanded** into concrete `field_mapping:<id>` statements in `PermissionService.loadSet` before the `PermissionSet` is constructed. `matches`/`visibilityPredicate` never see it (an unexpanded one fails closed).
3. **`station_views` replaces `station_instances`.** Full drop of the user attachment; capability/context rederive through `station_views → curated_view → connector_entity → connector_instance`. There is **no distinct "passthrough" type** — an unrestricted view (null `whereClause`, no projection rows = all columns) is the raw path; admins reach it via `AdminAccess *` (`read curated_view *` + `read field_mapping *`).
4. **Sharing-first, composed, no auto-grant.** `curated_view` → `SHAREABLE_RESOURCE_TYPES`; sharing a view composes `read curated_view:V` + one `read field_mapping in_curated_view:V` grant; "whole org" reuses the existing `team` grantee (→ member-role grant). Default views are generated but ungranted (default-deny).
5. **Two edit tiers, no new verb.** Attribute edit = `write curated_view`; projection edit = `write curated_view` **and** independent `read field_mapping` on each added field (the self-exposure guard).
6. **Structured projection + validated-SQL WHERE.** SELECT is a field-mapping join-table selection (off the injection surface); only `whereClause` is validated SQL — the one injection boundary, its own slice + adversarial pass.
7. **No system-owned views** — default views inherit `createdBy` from the entity's creator (org-owner fallback). Broader ownership model = #641.

## Scope

### In scope
- Three new tables (`curated_views`, `curated_view_field_mappings`, `station_views`) + dual-schema models; drop `station_instances` as a user attachment.
- `PERMISSION_CONDITIONS += in_curated_view` + `conditionParam` column on `permission_grants`/`permission_statements`; `loadSet` FK expansion; `PermissionSet.isDenied`.
- `curated_view` → `SHAREABLE_RESOURCE_TYPES` + `INSTANCE_SEARCHABLE_TYPES`; `GrantService` `curated_view` support + share composition (view→fields, station→views).
- `resolveViewsForSession(stationId, userId)` replacing `buildSessionViews`; view-scoping the four data-shape surfaces; capability/context rederivation from views.
- `whereClause` validator; curated-view CRUD routes + `GET /api/curated-views/:id/records`; Views nav page (`NAV_PAGE_IDS += "views"`, member-visible) + detail/records UI + widened `ShareDialog` + marked chips.

### Out of scope
- Always-live pins (#640); ownership model (#641); a general FK-condition framework; per-record `entity_record` deny; dynamic/`current_user.*` + writable (`WITH CHECK OPTION`) views.

## Surface

### 1. Schema — new tables (`apps/api/src/db/schema/`)

All use `...baseColumns` (id, created, createdBy, updated, updatedBy, deleted, deletedBy — **no** `organizationId`, declared per-table), snake_case in PG, and the `.where(sql`deleted IS NULL`)` partial-unique idiom. Exported from `schema/index.ts`.

**`curated-views.table.ts`**
```ts
export const curatedViews = pgTable("curated_views", {
  ...baseColumns,
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  connectorEntityId: text("connector_entity_id").notNull().references(() => connectorEntities.id),
  key: text("key").notNull(),               // per-org-unique; the session/queryable view name
  label: text("label").notNull(),
  description: text("description"),
  whereClause: text("where_clause"),        // validated SQL boolean expr; null = no row filter (all rows)
}, (t) => [
  uniqueIndex("curated_views_org_key_unique").on(t.organizationId, t.key).where(sql`deleted IS NULL`),
  index("curated_views_org_created_idx").on(t.organizationId, t.created, t.id).where(sql`deleted IS NULL`), // #433
  index("curated_views_entity_idx").on(t.connectorEntityId).where(sql`deleted IS NULL`),
]);
```
**Effective projection** = the view's `curated_view_field_mappings` rows, or — when it has **none** — *all* live (non-hidden) field mappings of `connectorEntityId`, resolved at build time (auto-tracking). No `isPassthrough` flag: an unrestricted view is just one with no projection rows and a null `whereClause`.

**`curated-view-field-mappings.table.ts`** (the projection join)
```ts
{ ...baseColumns, organizationId (FK), curatedViewId (FK curatedViews), fieldMappingId (FK fieldMappings) }
uniqueIndex("curated_view_field_mappings_view_fm_unique").on(curatedViewId, fieldMappingId).where(deleted IS NULL)
index("curated_view_field_mappings_view_idx").on(curatedViewId).where(deleted IS NULL)  // the FK-condition subquery + projection resolution
```

**`station-views.table.ts`** (replaces the `station_instances` attachment)
```ts
{ ...baseColumns, organizationId (FK), stationId (FK stations), curatedViewId (FK curatedViews) }
uniqueIndex("station_views_station_view_unique").on(stationId, curatedViewId).where(deleted IS NULL)
index("station_views_station_idx").on(stationId).where(deleted IS NULL)
```

### 2. Core models + dual-schema

`packages/core/src/models/`: `curated-view.model.ts`, `curated-view-field-mapping.model.ts`, `station-view.model.ts` — each `CoreSchema.extend({...})` + `CoreModel` + `ModelFactory` (entity-group.model.ts template), exported from `models/index.ts`.
```ts
export const CuratedViewSchema = CoreSchema.extend({
  organizationId: z.string(), connectorEntityId: z.string(),
  key: z.string().min(1), label: z.string().min(1),
  description: z.string().nullable(), whereClause: z.string().nullable(),
});
```
`apps/api/src/db/schema/zod.ts`: `createSelectSchema`/`createInsertSchema` pair per table. `type-checks.ts`: the 3-assertion `IsAssignable` block per table (drift → compile error).

### 3. `packages/core/src/models/permission.model.ts`

```ts
SHAREABLE_RESOURCE_TYPES = ["station", "pin", "curated_view"]           // + curated_view
INSTANCE_SEARCHABLE_TYPES = ["station","pin","portal","connector_instance","entity","curated_view"] // + curated_view
PERMISSION_CONDITIONS = ["created_by_caller","created_by_system","in_curated_view"]  // + in_curated_view
NAV_PAGE_IDS = [ …, "views" ]              // + views
MEMBER_VIEW_PAGE_IDS = ["stations","pinned","jobs","views"]            // + views (member-visible page)
```
`PermissionStatementSchema` + `PermissionGrantSchema` gain `conditionParam: z.string().nullable()` (the FK target view id; null for the ownership conditions). `objectCapability("curated_view")` now yields the `share` verb automatically (it's in `SHAREABLE`), `instanceScope:true` (in `INSTANCE_SEARCHABLE`). No `CALLER_CAPABILITY_ACTIONS` change (the prior `view.manage` idea is dead).

**Member share of `curated_view` is inert, not a grant of authority:** the `MemberAccess` seed loops `SHAREABLE_RESOURCE_TYPES` for a `share … created_by_caller` grant, but members can't create views, so they own none to share. Creation/sharing is effectively admin (via `AdminAccess *`).

### 4. Condition engine (`apps/api/src/services/`)

**`permission.service.ts` — `loadSet` FK expansion.** After `grants` load (`:121-125`), before `new PermissionSet` (`:126`):
```ts
const raw: EffectiveStatement[] = [...statements, ...grants];
return new PermissionSet(ctx, await PermissionService.expandFkConditions(raw, ctx, client));
```
`expandFkConditions(raw, ctx, client)`: pass through every statement whose `condition !== "in_curated_view"`; for each FK one, load its `conditionParam` view and resolve its **effective projection** (the `curated_view_field_mappings.fieldMappingId`s, or all live `field_mappings.id` where `connector_entity_id = view.connectorEntityId AND deleted IS NULL` when it has none), emitting one `{ effect, verb:"read", resourceType:"field_mapping", resourceId:<fmId>, condition:null }` per member. The original FK statement is dropped. `matches` (`permission-set.ts:361`) already fails closed on an unrecognized condition, so a missed expansion denies.

**`permission-set.ts` — `isDenied` (new).** Deny-wins subtraction for a view's rows (a view's read authority is the view grant, so absence-of-allow must **not** suppress; only an explicit deny does):
```ts
/** True iff an explicit deny statement matches (independent of any allow). */
isDenied(verb: string, resourceType: string, object?: PermissionObject): boolean
```

### 5. Session engine + the four data-shape surfaces

**`portal-sql.service.ts` — `resolveViewsForSession(stationId, userId, client)`** replaces `buildSessionViews(stationId, organizationId, client)`:
- view set = `station_views(stationId)` ∩ `{ V : set.can("resource.read", {type:"curated_view", id:V, createdBy}) }` (one `loadSet`).
- per granted `V`: columns = its **effective projection** (join rows, or all live entity field mappings when none) filtered to `set.can("resource.read", {type:"field_mapping", id:fmId})`; emit `CREATE OR REPLACE TEMP VIEW "<V.key>"` selecting those columns' `column_name` from `er__<connectorEntityId>`, `WHERE organization_id = '<org>' AND deleted IS NULL` **AND `(<whereClause>)`** when set.
- **suppress `V` entirely** if `set.isDenied("read","entity_record", …)` (class-level — the deny-wins subtraction; per-row deferred).
- `_meta_entities`/`_meta_columns` rebuild **per granted view** (id/key/label per view; columns = the view's granted columns). `_meta_column_catalog` is emitted **only when entity-management is available** (admin) — it's an org-wide catalog and leaks otherwise.
- `runSqlQuery` (`:381`) / `explainSqlQuery` (`:495`) pass `userId`; `sql_query` already holds it (`tools.service.ts:583`).

**Capability + context rederivation (source swap `station_instances` → `station_views`):** `resolveStationCapabilities`/`resolveEntityCapabilities` (`resolve-capabilities.util.ts`), `buildStationContext` (`portal.service.ts:1186`, **+`userId`**; `entities` = resolved views; call sites `:395`/`:689` thread `userId`), `loadConnectorInstanceContexts` (`:1234`, instances derived from the views' entities), and the **`station_context` tool** (`station-context.tool.ts`, returns per-view columns for members) all resolve their entity/instance set from the station's attached views. The system-prompt roster (`system.prompt.ts:614`) is fixed for free (it iterates `stationContext.entities`).

### 6. Sharing (`apps/api/src/services/grant.service.ts`, `routes/grant.router.ts`, `apps/web`)

- `resolveObject` (`grant.service.ts:50`) gains a `curated_view` case → `curatedViewsRepo.findById`. `ShareResourceType` (`@portalai/core/contracts`) widens to `station|pin|curated_view`; `ShareDialog` (`ShareDialog.component.tsx:201`) `resourceType` union widens.
- **View-share composition:** sharing `curated_view:V` writes the boundary-checked `read`(/`write`) grant **and** one composed row `{ verb:"read", resourceType:"field_mapping", resourceId:null, condition:"in_curated_view", conditionParam:V }` for the same principal (inside the same `hardDeleteShare`+`createMany` txn at `:180`). Boundary: `assertWithinBoundary` on the view covers it (reading the view implies its fields).
- **Station-share composition (own slice):** sharing `station:S` optionally composes `curated_view` + field grants for each `station_views(S)` view (dialog surfaces the attached views, default all, reviewable). Each is an independent, revocable grant row.
- "Whole org" is the existing `team` grantee → `sysrole:<org>:member` grant (`resolvePrincipal:73`) — reused unchanged.

### 7. CRUD routes (`apps/api/src/routes/curated-view.router.ts`, mounted `/api/curated-views`)

`entity-group.router.ts` pattern throughout (list `visibilityPredicate("curated_view", …)`; per-object `check("resource.write"/"resource.delete", {type:"curated_view", id, createdBy})`; factory→`model.update`→persist; `@openapi` per handler; response registered in `swagger.config.ts`).
- `GET /` — list (limit/offset/sortBy/sortOrder/search/include), `visibilityPredicate` filtered → the member sees only readable views. `include=fieldMappings,station` batch-loaded.
- `POST /` — create (admin via `resource.write` on class; duplicate `key` → 409). Body: `{connectorEntityId, key, label, description?, whereClause?, fieldMappingIds?[]}` (empty/omitted `fieldMappingIds` = an unrestricted view — all columns). **`whereClause` runs the validator (§8); the self-exposure guard verifies the caller can independently `read` each field in the *effective* projection — every listed `fieldMappingId`, or (when omitted) *all* the entity's current field mappings — else `CURATED_VIEW_FIELD_NOT_READABLE` (403).** So only a `read field_mapping *` holder (admin) can create an unrestricted view. Writes the view + its `curated_view_field_mappings` rows in a txn.
- `PATCH /:id` — per-object `resource.write`. Attribute edits (label/description/`whereClause`/tags) always; **projection edits re-run the field-readability guard on added mappings.**
- `DELETE /:id` — per-object `resource.delete`; soft-delete cascades `curated_view_field_mappings` + `station_views` + the view's grants in a txn.
- `POST /:id/attach` · `DELETE /:id/attach/:stationId` — station attachment (writes/removes `station_views`), admin-gated.
- **`GET /:id/records`** — the detail records table. `loadSet.can("resource.read", curated_view:id)` else 404; resolves projection (∩ field grants) + `whereClause` over `er__<entityId>`; **keyset-paginated** (`mode:"keyset"`); org+deleted guard; the same authorization the session uses (OQ2).
- New `ApiCode`s (`api-codes.constants.ts`): `CURATED_VIEW_NOT_FOUND`, `_DUPLICATE_KEY`, `_INVALID_PAYLOAD`, `_INVALID_WHERE_CLAUSE`, `_FIELD_NOT_READABLE`, `_FETCH_FAILED`, `_CREATE_FAILED`, `_UPDATE_FAILED`, `_DELETE_FAILED`.

### 8. `whereClause` validator (its own slice — the injection boundary)

`apps/api/src/services/curated-view-filter.validator.ts` — `validateWhereClause(clause: string, entity: {columns: string[]}): void` (throws `ApiError(400, CURATED_VIEW_INVALID_WHERE_CLAUSE)`). Parses the clause with a real SQL parser (confirm the existing LLM-SQL guard behind `runSqlQuery` can validate a *fragment*; if not, add `pgsql-parser`/`libpg_query`); asserts: a pure boolean expression; only `c_*` columns of *this* entity; an operator/function allow-list; **no** subqueries, writes, or cross-table refs. Validated **identically** whether authored by a human or the LLM. Authoring UX (REST-connector-style, LLM-assisted, live sample-output preview over `GET /:id/records?preview`) — frontend §9.

### 9. Frontend (`apps/web`)

- SDK: `api/curated-views.api.ts` (list/get/create/update/delete/attach/records — `entity-groups.api.ts` shape), `queryKeys.curatedViews` (`keys.ts`), registered in `sdk.ts`. Mutations invalidate `curatedViews.root` (+ `stations.root` on attach).
- **Views nav page** — `NAV_PAGE_IDS += "views"` forces a `SidebarNav` `PAGE_NAV` entry; `views/CuratedViews.view.tsx` wrapped in `guardedComponent("views")`; member-visible (in `MEMBER_VIEW_PAGE_IDS`). Card list (searchable/sortable/filterable, Entities-page shape); `Create View` + card delete/share gated by `useCapabilities().canOnResource("curated_view","write"/"delete")`.
- **View-detail** (`CuratedViewDetail.view.tsx`) mirroring entity-detail: tags, edit/delete, the `GET /:id/records` table; the create/edit dialog carries the field-mapping picker + the LLM-assisted `whereClause` editor + sample preview.
- `ShareDialog` widened to `curated_view`. Station-detail: **attach-view** replaces attach-connector; attached views render as chips, inaccessible ones **red-overlay-marked** (not hidden).

## Migration

`npm run db:generate -- --name curated-views-and-station-views` — commit the `.sql` + `meta/_journal.json` + `<n>_snapshot.json` (all three, per `project_drizzle_journal_must_be_committed`). Contents:
1. Create `curated_views`, `curated_view_field_mappings`, `station_views` (+ indexes above).
2. `permission_grants` / `permission_statements`: add `condition_param text`; drop + re-add `*_condition_check` to allow `in_curated_view`; optional CHECK `(condition = 'in_curated_view') = (condition_param IS NOT NULL)`.
3. **Data backfill (forward-only, `-- backfill:` marked, idempotent):** for each `station_instances(S,C)` row, per entity `E` of `C` → ensure a default (unrestricted) `curated_views` row (null `whereClause`, **no** projection rows = all columns, `key` from the entity key, `createdBy` = entity/instance creator, org-owner fallback) `ON CONFLICT (organization_id, key) WHERE deleted IS NULL DO NOTHING`, and a `station_views(S, V)` row. **No grant rows** (default-deny). Then the `station_instances` attachment is retired (the read/context paths stop reading it; the table may be dropped in a later forward migration once no code references it).
4. Backfill `MemberAccess` a `view page:views` grant for existing orgs (the #630 `0110` pattern — `MEMBER_VIEW_PAGE_IDS` now includes `views`).

Migrations stay **expand-only** (`lint:migrations` — the condition-check change is a widening, not destructive; the `station_instances` drop is a *later* migration after code stops referencing it).

## Seed

`SYSTEM_COLUMN_DEFINITIONS`-style per-org seeding is **not** used (views are entity-derived, not a static catalog — the backfill-coverage test doesn't apply). `AdminAccess` (`* *`) already covers `curated_view` CRUD + `page:views` with **zero** seed change. `MemberAccess`: `DATA_RESOURCE_TYPES` already includes `curated_view` (own-object r/w/d auto-granted, inert for members); add `views` to `MEMBER_VIEW_PAGE_IDS` so the seed loop emits the member `view page:views` grant (+ the §Migration backfill for existing orgs).

## TDD test plan

Per-package via `npm run test:unit` / `npm run test:integration` (never raw jest). Real files:

**`packages/core` (`npm run test:unit`)** — `models/__tests__/curated-view.model.test.ts` (+ the two join models): schema accepts/rejects; factory stamps `createdBy`/id. `permission.model.test.ts`: `curated_view` in SHAREABLE/INSTANCE_SEARCHABLE; `in_curated_view` in conditions; `views` in NAV/MEMBER pages. ≈ 12.

**`apps/api` unit (`npm run test:unit`)** — `permission-set.test.ts`: `isDenied` (explicit deny vs no-allow); an unexpanded `in_curated_view` denies. `permission.service.test.ts`: `expandFkConditions` (no-projection view → all entity fields; explicit → join members; drops the FK stmt). `curated-view-filter.validator.test.ts`: accepts a bounded predicate; rejects subquery/write/foreign column/non-boolean. `portal-sql.service.test.ts`: `resolveViewsForSession` projects granted columns, ANDs `whereClause`, suppresses on `entity_record` deny, `_meta_*` per-view, no-user fails closed. `grant.service.test.ts`: view-share composes the FK field grant; boundary rejection. `curated-view.router.test.ts`: CRUD + field-readability guard + records auth (dialog/route checklist). ≈ 60.

**`apps/api` integration (`npm run test:integration`)** — `__integration__/routes/curated-view.router.integration.test.ts`: CRUD + `GET /:id/records` (projection+filter+keyset), duplicate-key 409, self-exposure 403. `__integration__/services/curated-views-session.integration.test.ts`: two shared views over one wide table → a member sees only granted views/columns across query + `_meta_*` + `station_context`; deny subtracts; an admin (`*`) sees all columns. `__integration__/services/rbac-fk-expansion.integration.test.ts`: FK grant → readable field mappings; auto-tracking on projection change. `__integration__/db/migrate-default-views.integration.test.ts`: backfill generates default (unrestricted) views + `station_views`, no grants, idempotent; capability rederives from views. **Assert correctness, never query plans** (`project_no_plan_assertions`). ≈ 40.

**`apps/web` (`npm run test:unit`)** — `CuratedViews.view` (card list, gated create/share), `CuratedViewDetail` (records table, edit dialog validation), `ShareDialog` widened to `curated_view` (the dialog checklist), marked inaccessible chips. ≈ 30.

**Totals ≈ 142 cases.** The migration needs its own integration test (backfill above). No plan-assertion tests.

## Acceptance criteria

- One `accounts` entity, two shared views (`ne_accounts`/`sw_accounts`) over one wide table: a member sees only shared views + columns across the agent query path, `_meta_*`, `station_context`, and the Views UI.
- Sharing a view composes its field grants (recipient sees the columns); an explicit `deny` on the view, a field mapping, or `entity_record` always subtracts, even through a shared view.
- A view-editor cannot add a field mapping they can't independently read (403); attribute vs projection edits are distinct.
- A station attaches **views, not connectors**; a station with no attached-and-granted views yields an empty session; capability/context/roster/`station_context` all derive from views.
- A member cannot mutate via the agent what they can't in the UI (#629); the agent cannot target records a view hides.
- Migration: existing stations keep admin access via default (unrestricted) views; members are default-deny until shared; no orphaned `station_instances` read path.

## Risks & rollback

- **Injection via `whereClause`** — the one free-SQL surface. Mitigated by the validator (§8) + its adversarial pass; **fail-closed** (an unvalidated clause is rejected, never stored). Highest-risk slice.
- **Cutover member blackout** — default-deny means members go dark until an admin shares. This is intended + documented (Help/FAQ "share your default views"); admins retain access via default (unrestricted) views throughout, so it is not an outage, and it is reversible by sharing (no data change).
- **Missed FK expansion / a data-shape surface left entity-scoped** — would leak columns. Fail-closed by construction (unexpanded condition denies); the integration suite asserts all four surfaces are view-scoped.
- **Rollback** — forward-only. The feature is dark until views are shared; backing out = revert the code (the new tables sit unused; the `station_instances` attachment is only *dropped* in a later migration, so pre-drop the old path is still revertible).

## Files touched

- **core:** `models/{curated-view,curated-view-field-mapping,station-view}.model.ts` (+ `index.ts`), `models/permission.model.ts`, `contracts/*` (share + curated-view request/response schemas).
- **api schema/db:** `db/schema/{curated-views,curated-view-field-mappings,station-views}.table.ts` (+ `index.ts`), `db/schema/{zod,type-checks}.ts`, `db/repositories/{curated-views,curated-view-field-mappings,station-views}.repository.ts` (+ index + `DbService`), `drizzle/<n>_*.sql` (+ journal + snapshot).
- **api services/routes:** `services/permission.service.ts` (`expandFkConditions`), `services/permission-set.ts` (`isDenied`), `services/grant.service.ts`, `services/curated-view-filter.validator.ts`, `services/portal-sql.service.ts` (`resolveViewsForSession`), `services/portal.service.ts` (`buildStationContext`+`userId`, `loadConnectorInstanceContexts`), `utils/resolve-capabilities.util.ts`, `tools/station-context.tool.ts`, `tools/sql-query.tool.ts`, `prompts/system.prompt.ts`, `routes/curated-view.router.ts` (+ app mount), `routes/grant.router.ts`, `constants/api-codes.constants.ts`, `config/swagger.config.ts`, `services/seed.service.ts`.
- **web:** `api/{curated-views.api,keys,sdk}.ts`, `views/{CuratedViews,CuratedViewDetail}.view.tsx`, `components/SidebarNav.component.tsx`, `components/ShareDialog.component.tsx`, `utils/{routes,use-require-page-view}.util.ts`, station-detail attach UI.

## Next step

`docs/CURATED_VIEWS.plan.md` slices this into ordered, individually-testable commits — roughly: (1) schema + models + repos + the default-view/`station_views` migration; (2) `PERMISSION_CONDITIONS`/`conditionParam` + `loadSet` expansion + `isDenied`; (3) `resolveViewsForSession` + capability/context rederivation + the four surfaces; (4) `whereClause` validator (+ adversarial); (5) curated-view CRUD routes + records endpoint + self-exposure guard; (6) sharing + composition (view, then station); (7) Views nav page + detail/records UI + widened ShareDialog + marked chips — each behind a green suite.
