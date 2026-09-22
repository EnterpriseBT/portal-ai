# Curated views + always-live pins — Discovery

**Issue:** [EnterpriseBT/portal-ai#599](https://github.com/EnterpriseBT/portal-ai/issues/599)

**Why this exists.** Members today query connector data through the raw entity passthrough: `buildSessionViews` (`apps/api/src/services/portal-sql.service.ts:143`) exposes one temp view per readable **entity**, projecting every non-hidden column of its wide table. That is the read/exposure layer for almost all member data access, and it is all-or-nothing per entity — there is no way to grant a member a *slice* (some rows, some columns) of an entity, and "sharing = grant" is unsafe because the only grantable data object is the whole connector/entity. The #598/#620/#622 RBAC work built the grant + policy engine and even reserved `view` as a resource type (`packages/core/src/models/permission.model.ts:36`), but **nothing populates, grants, or reads a view yet**. This ticket adds the **view object** (a per-entity curated slice: row filter + column projection), the **`station_views`** attachment, the **per-user session-view engine**, **definer's-rights always-live pins**, a **per-caller tool-authorization gate**, and a **Views admin page** with role-gated navigation. This is the read/exposure layer that makes member data access curated and "sharing = grant" safe.

## The current shape

### Connector → entity → station data model

| Piece | Location | Note |
|---|---|---|
| instance → entity | `connector-entities.table.ts` | `connector_instances` own `connector_entities` |
| row storage | `wide-table.repository.ts:78` (`tableName`), `:87` (`selectAll`) | rows in `entity_records` + a **dynamic** wide table `er__<connector_entity_id>` (not in Drizzle static schema); columns from `wide_table_columns` |
| station ↔ connector | `station-instances.table.ts:11` | `station_instances` join = `{stationId, connectorInstanceId}` only — no per-entity/per-view row |
| capability resolve | `resolve-capabilities.util.ts:90` (`resolveStationCapabilities`), `:175` (`resolveEntityCapabilities`) | fans out to `{read,write,push}` per entity of each attached instance |

The station's current exposed attachment is the **connector instance**; there is no station↔entity or station↔view link. `station_views` is the new attachment table, paralleling `station_instances`.

### Session-view / query-exposure engine

`PortalSqlServiceImpl.buildSessionViews(stationId, organizationId)` (`portal-sql.service.ts:143`) is the exact seam. It calls `resolveEntityCapabilities` (`:156`), filters to `read === true`, and for each entity emits `CREATE OR REPLACE TEMP VIEW "<entityKey>"` selecting `_record_id`, a `_connector_entity_id` literal, `source_id`, and every non-hidden `c_*` column from `er__<id>`, `WHERE` org-pinned `AND deleted IS NULL` (`:200-227`). **The entity `key` is the queryable view name** (`viewMap`, `:74-83`). It also emits introspection views `_meta_entities` / `_meta_columns` / `_meta_column_catalog` (`:264-329`). `runSqlQuery` (`:347`) opens a READ ONLY txn, materializes the views, runs validated LLM SQL, and rolls back. **`buildSessionViews` takes no `userId`** — that signature change is the heart of `resolveViewsForSession(stationId, userId)`.

### Pins (portal results)

`portal_results` (`portal-results.table.ts:28`) stores `type` (`text|data-table|d3|geo`), a `content` jsonb, `snapshotUpdatedAt`. Pinning (`portal-results.router.ts:109` → `PortalResultPinService.materialize:199`) persists **both** embedded rows **and** a re-executable `pipeline` in `content`. The re-execution path exists: `POST /:id/refresh` (`:315`) → `PortalVizRefreshService.refreshPinnedResult` (`portal-viz-refresh.service.ts:152`) reads `content.pipeline` (`VizPipelineSchema` = `{sql, stationId}`), re-runs read-only **under the org**, persists the fresh snapshot (`:212`); no pipeline → 422 `VIZ_WIDGET_NOT_REFRESHABLE` (`:182`). `text` pins are static; `d3/geo/data-table` are `REFRESHABLE_BLOCK_TYPES` (`:73`). Detail view: `apps/web/src/views/PinnedResultDetail.view.tsx`. **The pipeline binds `stationId` + caller org only — no definer identity is captured, and refresh is caller-initiated, not always-live.**

### PermissionService + the tool-authorization layer

`permission.service.ts`: `loadSet` (`:72`, principals = user + roles + groups, union of `policy_attachments` + `permission_grants`), `check` (`:126`, 403 on deny), `capabilities` (`:139`). `permission-set.ts`: `check`/`can` (`:101`), `assertWithinBoundary` (`:118`), `visibilityPredicate(resourceType, cols)` (`:223`, own/system/shared/deny, fail-closed), `ACTION_MAP` (`:49`), `normalize` (`:277`). Tools are built in `ToolService.buildAnalyticsTools(organizationId, stationId, userId, portalId)` (`tools.service.ts:393`) — `userId` already threads to each `.build()` (`sql_query:510`). **Tools call `PermissionService` nowhere today (zero references).** Write authorization is coarse/station-level: `isWriteGated` tools are dropped *wholesale* when the station has no write capability (`:760-768`), never per-caller. `wrapWithCostGate(tools, {organizationId,userId,stationId,portalId})` (`:773`) is the natural injection point. `ToolCapability` (`tool-capability.model.ts:132`) carries `writes[]` — the discriminator a gate keys on. A governance pack registers in `builtin-toolpacks.ts` (`:1375`) + `BuiltinToolpackSlugSchema` (`:32`).

### RBAC grants + the `view:<id>` pattern

`view` is already in `PERMISSION_RESOURCE_TYPES` (`permission.model.ts:36`) and `DATA_RESOURCE_TYPES` (`:62`) but **not** `SHAREABLE_RESOURCE_TYPES` (`:79`) — the model comment (`:76`) states data types are "governed by views + policies in #599, never user-shared." A `PermissionGrant` (`:210`) is `{principalType, principalId, effect, verb, resourceType, resourceId, condition}`; `view:<id>` = an allow grant `resourceType:"view" verb:"read" resourceId:<viewId>`, resolved through `loadSet` → `resolve`/`matches` (`permission-set.ts:300`). The model knows `view` structurally; **no seeded policy or route grants/checks it — #599 wires the read path.**

### Admin UI + role-gated navigation (apps/web)

`Authorized.layout.tsx` → `SidebarNav.component.tsx:120` renders a **flat, ungated** nav (Dashboard, Stations, Toolpacks, Connectors, Entities, …, Pinned Results, `:206-265`). Per-role gating is `useCapabilities()` (`use-capabilities.util.ts:30`) → `can(action)`; the canonical pattern is `Settings.view.tsx:114` (`canAuthorAccess = can("member.role.assign")` gates the Access tab → `modules/AccessAuthoring/`). A Views admin page mirrors that (`views/Views.view.tsx` + route + a CRUD module). `CALLER_CAPABILITY_ACTIONS` (`permission.model.ts:105`) needs a new action (e.g. `view.manage`) — SidebarNav does no gating today.

### Tiers / entitlement

`tier-catalog.ts` `TIER_CATALOG` (`:105`) gives each tier `builtinToolpacks` (`:46`); `standard` = `["data_query","web_search","entity_management"]` (`:128`), `pro`/`enterprise` = all (`:194`). Enforced via `EntitlementService.splitBuiltinPacks` in `buildAnalyticsTools` (`tools.service.ts:438`). System tools bypass entitlement via the `alwaysAvailable` capability flag (`:472`); named boolean entitlements exist too (`customToolpacks:48`, `customRbac:51`).

## The design space

### Decision 1 — Row-filter representation

| | A. Structured JSON predicate | B. Raw SQL `WHERE` fragment | C. Reuse a condition model |
|---|---|---|---|
| Safety | Parameterizable, validatable | Injection surface; hard to bound | Safe but narrow |
| Expressiveness | column · op · value, AND-combined (OR later) | Arbitrary | Only the RBAC ownership conditions |
| Composes with org+`deleted` guard | Yes (ANDed) | Fragile | Yes but too narrow |

**Lean: A.** A bounded predicate (`{column, op ∈ eq|ne|in|gt|lt|contains, value}` AND-combined) injects safely into the existing view `WHERE` and validates against `wide_table_columns`; static only (no `current_user.*` this increment).

### Decision 2 — Where the curated slice reaches the session

| | A. Extend `buildSessionViews` | B. Persistent per-org PG views | C. Separate query rewriter |
|---|---|---|---|
| Reuses the existing seam | Yes | No | No |
| Per-session isolation | Yes (temp views, already rolled back) | No (schema clutter, migration churn) | Duplicates the builder |
| Multiple views per entity | Natural — `key` → distinct view name | Awkward | Awkward |

**Lean: A.** Rewrite `buildSessionViews` to take `userId`, drive the view set from `station_views` ∩ the caller's `view:<id>` grants (not raw entity capabilities), and emit each view's **column projection** (subset of `c_*`) + **row filter** (ANDed after org + `deleted`). `_meta_*` + the agent roster rebuild from the resolved views.

### Decision 3 — Attachment + cutover

**Lean: a `station_views` table** (`{stationId, viewId}`, parallel to `station_instances`), with an **eager backfill** that generates one **passthrough view** (full projection, no filter) per currently-attached entity and attaches it — so behavior is unchanged on cutover and grants can be authored immediately. Raw connector/entity read grants become **admin-only** (members read only through views).

### Decision 4 — Definer's-rights, always-live pins

| | A. Pipeline-only, execute under definer on render | B. Keep embedded rows + re-check |
|---|---|---|
| "Never contains gated rows" | Yes — no rows persisted | No — rows sit in `content` |
| Sharing conveys current data | Yes | Stale |
| Loses access → empties | Yes (definer's views resolve empty) | Needs a scrub |

**Lean: A.** Drop embedded rows from refreshable pins; add a first-class **`definer_principal_type` + `definer_principal_id`** on `portal_results` (user first cut per OQ8; queryable so offboard can sweep). Render/refresh executes `content.pipeline` under the **definer's** `resolveViewsForSession` — so a shared pin shows the definer's current data and empties when their access is gone. Rebinding a definer to a role is a later config flip, not a migration.

### Decision 5 — Per-caller tool-authorization gate

**Lean: a build-time wrapper** (mirroring `wrapWithCostGate`) that, for every tool with non-empty `ToolCapability.writes[]`, calls `PermissionService.check(callerUserId, action, object)` before `execute` and returns a **typed refusal** on deny (never a throw the agent can't relay). Injected in `buildAnalyticsTools` alongside the cost gate; a guard test asserts every write tool is wrapped. This is the standing rule — *safety gates get server enforcement, not prompt instructions*.

### Decision 6 — Governance toolpack entitlement

**Lean: `alwaysAvailable`** (never tier-gated) — RBAC/view administration is a security feature, not a monetization axis (OQ9). Availability ≠ authorization: the pack is present for everyone, but each of its tools is still per-caller `PermissionService.check`-gated (Decision 5), so only admins can actually use it.

### Decision 7 — Views admin UI + role-gated nav

**Lean:** add a `view.manage` capability action (`CALLER_CAPABILITY_ACTIONS`), held by the system `owner`/`admin` roles so custom RBAC can grant it. Gate `SidebarNav` per capability: **members** see Stations / Portals / granted views; **admins** additionally see the raw plumbing (Connectors, Entities, Column Definitions, …) + a new **Views** admin page (CRUD row-filter + projection, attach, grant — mirroring `modules/AccessAuthoring/`). Every route is server-authoritative.

## Tradeoff comparison

| | D1 JSON filter | D2 extend builder | D3 station_views + backfill | D4 pipeline-only pins | D5 wrapper gate | D6 alwaysAvailable | D7 view.manage nav |
|---|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| New table / column | `views` | — | `station_views` | `definer_*` cols | — | — | — |
| Contract/enum change | — | `buildSessionViews` sig | — | pin content shape | typed refusal code | pack slug | `view.manage` action |

## Recommendation

1. Add a **`views`** table: `{organizationId, connectorEntityId, key (per-org-unique), label, rowFilter (JSON predicate), columnProjection (string[])}`; static only.
2. Add **`station_views`** (`{stationId, viewId}`); an eager backfill generates + attaches one **passthrough view** per attached entity; raw entity/connector read grants become admin-only.
3. Rewrite **`buildSessionViews`** into `resolveViewsForSession(stationId, userId)` — the view set = `station_views` ∩ the caller's `view:<id>` grants; each temp view carries the projection + filter; `_meta_*` and the roster rebuild from views.
4. Make refreshable pins **definer's-rights + always-live**: pipeline-only, `definer_principal_*` on `portal_results`, executed under the definer's session views on render.
5. Add a **per-caller tool gate** wrapper (`PermissionService.check` on every `writes[]` tool, typed refusal) + a **governance toolpack** (view/grant/role management), `alwaysAvailable`.
6. Add a **`view.manage`** action, a **Views admin page**, and **role-gated `SidebarNav`** (curated for members, full plumbing for admins), server-authoritative.

## Open questions

1. **Row-filter DSL scope.** How expressive for v1? **Lean:** `{column, op, value}` over `eq|ne|in|gt|lt|contains`, AND-combined; OR-trees + `current_user.*` deferred (schema leaves room via the JSON shape).
2. **Definer storage.** Column vs buried in `content` jsonb? **Lean:** first-class `definer_principal_type`/`definer_principal_id` columns on `portal_results` — offboard/revocation must query them.
3. **Always-live execution cost.** Execute the pipeline on every render (fresh, N queries per dashboard) vs snapshot-with-TTL? **Lean:** execute-on-render under the definer for correctness (the pipeline is bounded read-only SQL, same as today's refresh); add caching only if metrics show fan-out pressure — recorded, not built.
4. **Cutover generation.** Lazy (first session) vs eager backfill migration? **Lean:** eager backfill (one passthrough view + `station_views` row per attached entity), mirroring the #622 per-org backfill pattern, so behavior is unchanged the moment the migration lands.
5. **`view.manage` vs reuse.** New action vs owner/admin heuristic? **Lean:** a new `view.manage` action seeded onto `owner`/`admin` — so an org can delegate view administration through a custom role without code changes.

## Enterprise-scale considerations

- **Concurrency & correctness** — view/`station_views` CRUD is check-then-act (validate entity ownership + key uniqueness in a txn); the session build stays a read-only txn (already safe); the passthrough backfill is idempotent (`ON CONFLICT` on `(org, key)`). **Lean: fine.**
- **Accuracy & auditability** — view create/update/delete, attach/detach, `view:<id>` grants, and definer rebinds all write `audit_log` rows (new actions), so exposure changes are reconstructable. **Lean: audit each.**
- **Failure modes** — **fail-closed everywhere**: a session with no resolvable views sees nothing (never the raw passthrough); a pin whose definer lost access empties (never stale/gated rows); the tool gate denies on an unresolvable check. This is the security posture of the feature. **Lean: fail-closed.**
- **Scale & unbounded growth** — multiple views per entity is admin-bounded; the one real concern is **always-live pin fan-out** (a dashboard of N pins = N pipeline executions per render). **Lean:** accept for v1 (bounded read-only SQL), note caching as a follow-up (OQ3).
- **Multi-tenancy** — views, `station_views`, pins, definers all org-scoped; the per-org-unique `key` prevents multiple-views-per-entity name collision within an org. **Lean: fine.**
- **Contract stability** — the JSON filter leaves room for dynamic/`current_user.*`; `definer_principal_*` already admits a role; the tool gate keys on `ToolCapability.writes[]` so new tools plug in without touching the gate. **Lean: shaped for the deferred increments.**
- **Data lifecycle** — a view is orphaned when its entity is soft-deleted (cascade the `station_views` attachment + the view); a pin is definer-scoped so offboard naturally empties it. **Lean:** cascade on entity delete; no new retention window.

## What this doesn't decide

- **Dynamic / parameterized (RLS) views** (`current_user.*`) — deferred; the JSON filter shape leaves room. (PRD out-of-scope.)
- **Writable / updatable views** (`WITH CHECK OPTION`) — writes stay on the existing instance-capability path. (PRD out-of-scope.)
- **Definer = role rebind UI** — the schema admits a role definer; the config-flip UI is a later increment.
- **FAQ / marketing content** for views — owned by the #615 documentation-alignment audit, run after #599/#613 land.

## Next step

`docs/CURATED_VIEWS.spec.md` pins the contract (the `views` + `station_views` tables + the dual-schema models, the `resolveViewsForSession` signature, the `definer_principal_*` columns + pin content change, the `view.manage` action + the governance pack + the typed tool-refusal code, and the SDK/route surface). `docs/CURATED_VIEWS.plan.md` then slices it — roughly: (1) `views` + `station_views` schema + passthrough backfill; (2) `resolveViewsForSession` rewrite (projection + filter, `_meta_*`/roster from views); (3) definer's-rights always-live pins; (4) per-caller tool gate + governance toolpack; (5) Views admin page + role-gated nav — each behind a green suite.
