# Curated views (per-user data exposure) — Discovery

**Issue:** [EnterpriseBT/portal-ai#599](https://github.com/EnterpriseBT/portal-ai/issues/599)

**Why this exists.** Members today read connector data through a raw, capability-based passthrough. `buildSessionViews(stationId, organizationId)` (`apps/api/src/services/portal-sql.service.ts:143`) exposes one temp view per entity a station can read — gated only by connector capability (`resolveEntityCapabilities`, `:156`), keyed only by org, reading **zero** permission grants and taking **no `userId`**. Every member on a station sees identical raw data; there is no way to grant a member a *slice* (some rows, some columns). The RBAC engine (#598/#620/#621) already reserves `curated_view` as a data resource type (`packages/core/src/models/permission.model.ts:48,81`) and deliberately keeps it **out** of `SHAREABLE_RESOURCE_TYPES` pending this ticket — but nothing populates, grants, or reads a view yet. This is the read/exposure layer that switches member data access from capability to **curated-view grants**, adds field-mapping-level access control (deferred here from #630), and makes "share a pre-curated slice, never a raw connector" real. *This is the object that carries almost all member data access.*

> **Lineage.** Replaces the 2026‑09‑22 discovery (recoverable via `git show`). Four decisions since split out and **landed** — the per-caller tool gate + governance toolpack (**#629**) and role-gated navigation (**#630**). Two more split out during *this* workshop: **always-live definer's-rights pins → #640** (they consume this ticket's per-user session seam; curated views is the foundation), and **object-ownership `createdBy` semantics → #641** (agent-generated vs system-created). #630 explicitly deferred **field-mapping read scoping** to here.

## The current shape

### The exposure engine — the seam this rewrites

`PortalSqlServiceImpl.buildSessionViews(stationId, organizationId, client)` (`portal-sql.service.ts:143`) resolves readable entities from **connector capability only** (`:156`) and per entity emits `CREATE OR REPLACE TEMP VIEW "<entityKey>"` projecting every non-hidden `c_*` column `FROM er__<id> WHERE organization_id = '<org>' AND deleted IS NULL` (`:200-226`) — the org literal embedded so the LLM can't escape scope; the entity `key` is the queryable view name. Three introspection views follow — `_meta_entities` (`:265`), `_meta_columns` (`:275`), `_meta_column_catalog` (`:318`). Consumers `runSqlQuery` (`:381`) and `explainSqlQuery` (`:495`) call it **2-arg** `(stationId, organizationId)`. There is **no "agent roster" view** — the PRD's "roster" is the `_meta_*` set.

### Connector → entity → station data model

| Piece | Location | Note |
|---|---|---|
| station ↔ instance | `station-instances.table.ts:11` | `{stationId, connectorInstanceId}`, unique-where-not-deleted — the shape `station_views` mirrors |
| entity | `connector-entities.table.ts:17` | `{organizationId, connectorInstanceId, key, label}`, unique on `(org, key)` |
| row storage | `wide-table.repository.ts:79` | dynamic `er__<connector_entity_id>` (not in Drizzle static schema) |
| columns / **field mappings** | `wide-table-columns.table.ts:19` | `columnName` (`c_amount`) ↔ **`fieldMappingId`**, `pgType`, `retiredAt` — **one column ↔ one field mapping** |
| capability resolve | `resolve-capabilities.util.ts:90` (station), `:175` (entity) | `resolveEntityCapabilities` → `Record<entityId,{read,write,push}>` |

`column ↔ field_mapping` is 1:1, which is what makes field-mapping the natural column-ACL grain.

### RBAC engine + the (inert) `curated_view` type

`curated_view` is in `PERMISSION_RESOURCE_TYPES`/`DATA_RESOURCE_TYPES` (`permission.model.ts:48,81`), **not** `SHAREABLE_RESOURCE_TYPES` (`:95`), with object verbs via `RESOURCE_CAPABILITIES.curated_view` (`:288`). `PERMISSION_CONDITIONS` is **closed** to `created_by_caller`/`created_by_system` — "data-attribute slicing is done with views (#599), never a dynamic condition" (comment above `:107`). The engine already resolves an id-scoped grant with **no** special-casing: `PermissionService.loadSet` (`permission.service.ts:80`) → `PermissionSet.can` (`permission-set.ts:108`) → `resolve` (`:350`, **deny-overrides-allow**, default-deny) → `matches` (`:361`, verb/type/**id**/condition). `visibilityPredicate` (`:273`) is the list-filter surface. Nothing reads or grants `curated_view` today.

### What #630 shipped (nav) and #629 shipped (tool gate)

Nav is data-driven: `NAV_PAGE_IDS` (`permission.model.ts:155`, single source), `MEMBER_VIEW_PAGE_IDS` (`:175`), `page` a `view`-only pseudo-resource. FE `useCapabilities` (`use-capabilities.util.ts:56`) → `canViewPage`. `SidebarNav` (`SidebarNav.component.tsx:39`) forces a `PAGE_NAV` entry per page id (compile error otherwise), renders `visibleNavItems` (`:110`); route guard `guardedComponent(pageId)` (`use-require-page-view.util.ts:40`) → `ForbiddenView`. #629's `wrapWithPermissionGate` (`permission-gate.service.ts:86`) gates each write tool per-caller (fail-closed, typed `TOOL_PERMISSION_DENIED` result), wired at `tools.service.ts:885`; `sql_query` already threads `userId` (`tools.service.ts:583` → `sql-query.tool.ts:126`).

### UI precedents

`apps/web/src/modules/AccessAuthoring/` — container + editor-dialog split, SDK slices (`roles.api.ts:14`, registered `sdk.ts:24`, keyed `keys.ts:46-50`). The Views admin CRUD mirrors this; the **view-detail records table** mirrors the existing entity records list/detail UI (Entities page — exact components pinned in spec).

## The design space (resolved in workshop)

### D1 — Read-authorization: composition, deny-always-wins

What a user sees through view `V`:
- **Rows** = V's `whereClause`-filtered rows **minus** any explicit `deny entity_record` (deny always overrides allow).
- **Columns** = V's projected field mappings **∩** the caller's `read field_mapping` grants (deny wins).
- **Gated by** `read curated_view:V` (and no `deny curated_view:V`).

**Decided.** A view is the read *authority* for the normal (no-deny) case — different resource type from `entity`, so a view read doesn't require an entity grant — but it **never** overrides an explicit deny. That keeps composition pure and avoids per-case heuristics. An admin issuing `deny read entity_record *` nukes the platform's purpose; that's their prerogative, documented as an anti-pattern (gate records **with views, not RBAC directly**). Members never hold direct `read entity_record`; admins read raw via `AdminAccess *`.

### D2 — View shape: structured projection + validated-SQL WHERE

| Part | Representation | Why |
|---|---|---|
| Columns (SELECT) | a **structured field-mapping selection** (`curated_view_field_mappings` join table) | enables field-mapping ACL (D3); keeps SELECT off the injection surface |
| Rows (WHERE) | **LLM-authored, validated SQL** fragment, REST-connector-style (sample-output preview, hand-editable) | non-technical authorability; the *only* free-SQL surface |

**Decided.** Only the `whereClause` is free SQL, validated **identically** whether a human or the LLM wrote it — parsed (real SQL parser), allow-listed to a pure boolean expression over *this entity's* columns, no subqueries/functions/writes; the sample preview runs it read-only/LIMIT-bounded as validation-by-execution. This is the feature's injection boundary → its own plan slice + adversarial pass. Views are owned by the parent entity's creating user (**no system-owned views**; the broader convention is #641).

### D3 — Field-mapping ACL via an FK condition + join table

`field_mapping` becomes a gated + shareable resource. A new **FK-shaped condition** `read field_mapping where curated_view=<V>` resolves (via the `curated_view_field_mappings` join table) to `field_mapping.id IN (SELECT field_mapping_id FROM curated_view_field_mappings WHERE curated_view_id = V)`.

**Decided.** This gives compact grants (one condition per view, not N-per-column), **auto-tracking** (adding a field mapping extends grantees with no policy edit), and preserves the **self-exposure guard**: to add field X to V, the editor must independently satisfy `read field_mapping:X` — and since X isn't in V's join table yet, V's own condition can't grant it, so the editor needs X via another readable view / direct grant / `*`. The condition resolves to a single **fixed, indexed, parameterized** subquery shape — a *controlled* extension to the condition engine (today: bare column-equality), not arbitrary conditions. **Scoped to this one relationship**; a general FK-condition framework is deferred (no second caller — the "no speculative infra" rule). Column-level differentiation becomes "grant a *narrower view*," with `deny field_mapping:X` as the rare per-user exception.

### D4 — Grant delivery: sharing-first, no auto-grant

**Decided.** `curated_view` joins `SHAREABLE_RESOURCE_TYPES` (gets a `ShareDialog`). A **default (passthrough) view** is auto-generated per attached entity but **not auto-granted** (default-deny) — so cutover *changes* behavior (members go dark until an admin shares; a conscious explicitness-over-continuity trade). Sharing **composes** independent, individually-revocable grants:
- share view V → `read curated_view:V` + `read field_mapping where curated_view=V`
- share station S → the above for S + each attached view (reviewable in the dialog)
- "whole org" → a revocable grant to the member-role/everyone principal — **not** the immutable `MemberAccess` policy (this is what makes it revocable, the objection that killed a member-role *policy* grant).

### D5 — Session engine: `resolveViewsForSession(stationId, userId)`

**Decided.** Replace the 2-arg `buildSessionViews`; view set = `station_views` ∩ the caller's granted `curated_view`s (independent of station — attachment scopes *surfacing*, the grant scopes *authority*). Each temp view emits its projection (∩ field grants) + `whereClause`, ANDed after the org+`deleted` guard, minus entity_record denies. `_meta_*` rebuild **per-view** (two slices of one entity = two roster rows). `runSqlQuery`/`explainSqlQuery`/`sql_query` thread `userId`; every caller must resolve a real user principal (fail-closed — no "all entities" fallback). Per **OQ2**, the same authorization backs both the agent session and the UI records endpoint.

### D6 — Views UI + a records endpoint

**Decided.** Editing tiers use **no new verb**: attribute-edit (name/description/`whereClause`/tags) = `write curated_view`; projection-edit = `write curated_view` **+** independent `read field_mapping` on each added field.
- **Views nav page** — member-visible (in `MEMBER_VIEW_PAGE_IDS`, backfilled like #630), listing the caller's *granted* views as a searchable/sortable/filterable **card list** (à la Entities/Connectors); `Create View` + card delete/share gated to admin; plugs into #630 (`NAV_PAGE_IDS += "views"`, `guardedComponent`).
- **View-detail page** mirroring entity-detail — tags, edit/delete, and a searchable/sortable/filterable **records table** over `GET /api/curated-views/:id/records` (projection + filter applied, gated by `read curated_view:id`, keyset-paginated per the CLAUDE.md indexing rules).
- **Attached-but-inaccessible views render as marked (red-overlay) chips** — existence is not secret, data is gated; underlying field/data denials surface in-session and prompt the user to ask their admin. (This supersedes the earlier "silently hide" lean.)

## Recommendation

1. `curated_views` + `curated_view_field_mappings` join tables (dual-schema); `whereClause` validated SQL, projection = selected field mappings; `createdBy` = entity creator.
2. `station_views` attachment + a data migration generating one **passthrough** view per attached entity (**no** grant backfill).
3. Field-mapping ACL: gate + share `field_mapping`; add the single FK condition `field_mapping where curated_view=<id>`; columns = projection ∩ field grants.
4. `resolveViewsForSession(stationId, userId)` — deny-wins composition, `_meta_*` per-view, `userId` threaded through all callers.
5. `curated_view` `ShareDialog` + station-share composition; "whole org" = revocable role/everyone grant.
6. Views nav page (member-visible, admin-CRUD) + view-detail records page + `GET /api/curated-views/:id/records`; inaccessible views shown marked.

## Open questions

1. **"Whole-org" principal shape.** The member **role** grant (auto-includes future members) vs a dedicated `everyone` principal? **Lean:** member-role grant — future members inherit, and it's a plain revocable grant row. Confirm at spec.
2. **FK-condition encoding in `visibilityPredicate` + the SQL translator.** The exact place the `IN (SELECT …)` shape plugs into `permission-set.ts:273/350`. **Lean:** a named condition variant carrying `{joinTable, fkColumn, value}`, resolved to the fixed subquery; index `curated_view_field_mappings(curated_view_id)`. Spec detail, not a design fork.
3. **Default-view generation for cutover ownership.** A pre-existing entity's "creating user" may be ambiguous for the migration. **Lean:** inherit `createdBy` from the `connector_entity` (or its instance) creator; fall back to the org owner. Confirm in spec.
4. **Records-endpoint scale.** The view-detail table over a large `er__<id>`. **Lean:** keyset pagination (`usePagination` `mode:"keyset"`), the view's `whereClause` + projection pushed into the query; index per the CLAUDE.md growth rules.

## Enterprise-scale considerations

- **Concurrency & correctness** — view / `station_views` / projection CRUD is check-then-act in a txn (per-org `key` uniqueness, projection field-read guard); the session build stays a read-only txn; default-view generation is idempotent (`ON CONFLICT (org, key)`). **Lean: fine.**
- **Accuracy & auditability** — view CRUD, projection edits, attach/detach, and every share/grant/deny write `audit_log` rows, so exposure changes are reconstructable. **Lean: audit each.**
- **Failure modes** — **fail-closed + deny-wins everywhere**: no resolvable views ⇒ empty session (never the raw passthrough); a no-user caller resolves nothing; an explicit deny always subtracts; a retired projected column drops rather than errors. **Lean: fail-closed.**
- **Scale & unbounded growth** — session build is O(granted views) temp-view DDL, same order as today's O(readable entities); the FK condition is one indexed subquery; the records endpoint is keyset-paginated. The field-mapping grant count is compact (one condition per view, not per column). **Lean: fine.**
- **Multi-tenancy** — views, join rows, `station_views`, grants all org-scoped; per-org `key` prevents collision; the embedded org literal keeps the LLM boundary. **Lean: fine.**
- **Contract stability** — the single FK condition is the first instance of a general FK-condition pattern; the `whereClause` leaves room for `current_user.*`; `resolveViewsForSession(stationId, userId)` is the exact seam #640's definer's-rights pins consume unchanged. **Lean: shaped for the deferred increments.**
- **Data lifecycle** — a `curated_view` cascades on entity soft-delete (its join rows, `station_views` attachment, and grants go with it). No new retention window. **Lean: cascade on entity delete.**

## What this doesn't decide

- **Always-live definer's-rights pins** → **#640** (consumes `resolveViewsForSession` unchanged).
- **Object ownership: agent-generated vs system-created** → **#641** (this ticket only adopts "default views owned by the entity's creator").
- **A general FK-condition policy framework** — only `field_mapping ∈ curated_view` is built.
- **Per-record `entity_record` deny granularity** — deny-wins as principle; v1 honors class/entity-level; per-row subtraction deferred.
- **Dynamic/RLS views** (`current_user.*`) and **writable views** (`WITH CHECK OPTION`) — writes stay on the instance-capability + #629 path.

## Next step

`docs/CURATED_VIEWS.spec.md` pins the contract: the `curated_views` + `curated_view_field_mappings` + `station_views` tables and dual-schema models; the `whereClause` validator (its own slice); the FK condition + `visibilityPredicate`/SQL-translator wiring; `resolveViewsForSession(stationId, userId)` + the caller thread-through; `curated_view` → `SHAREABLE_RESOURCE_TYPES` + `ShareDialog` + station-share composition; the `views` nav page + `GET /api/curated-views/:id/records`. `docs/CURATED_VIEWS.plan.md` then slices it — roughly: (1) schema + default-view migration; (2) FK condition + field-mapping ACL; (3) `resolveViewsForSession` rewrite (`_meta_*` per-view, deny-wins, `userId`); (4) `whereClause` validator + authoring; (5) sharing + composition; (6) Views nav page + detail/records UI — each behind a green suite.
