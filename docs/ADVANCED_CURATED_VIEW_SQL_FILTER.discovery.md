# Advanced curated-view SQL filter — Discovery

**Issue:** [EnterpriseBT/portal-ai#644](https://github.com/EnterpriseBT/portal-ai/issues/644)

**Why this exists.** A curated view's row filter is a structured `FilterGroup` (#599), compiled into the view's `CREATE TEMP VIEW` DDL. It is injection-free by construction, but deliberately scalar-only: `json` and `geometry` columns get only `is_empty`/`is_not_empty` (`packages/core/src/contracts/filter.contract.ts:90-94`), and there are no cross-column predicates, functions, or JSON paths. So a *persistent* view can't say "parcels within 5 miles of this point" (`ST_DWithin`), `payload->>'status' = 'active'`, or `amount > cost`. Today those exist only as ad-hoc agent SQL, which nobody can share as a governed slice.

This ticket adds an opt-in **advanced mode** that stores a SQL boolean fragment, gated by a validator that has the same strength as the agent-SQL sandbox. It is the "hand-editable SQL + LLM assist + sample preview" path for technical users. The default builder and its injection-free guarantee stay untouched.

**Correction to the issue.** The issue names `node-sql-parser`. Hotfix #660 removed it. The repo now parses with **`libpg-query@17.7.4`**, Postgres 17's own parser compiled to WASM (`apps/api/package.json:69`), imported only by `apps/api/src/services/portal-sql-parse.util.ts`. This doc is written against that parser. The issue's "data-defined entitlement" wording is also loose: tier entitlements are typed boolean columns (see below).

PRD gate answers, now in the issue:
- **Actor:** anyone holding the view's per-object `curated_view` write.
- **Surface:** `CuratedViewEditorDialog` only; no agent tool.
- **Tier:** an entitlement, with an upsell when it's missing.
- **Columns:** referenced columns are pinned through #802's view-dependency lock.

## The current shape

### Curated view storage and write path

| Piece | Location | Note |
|---|---|---|
| `filter` column | `apps/api/src/db/schema/curated-views.table.ts:33` | jsonb `FilterGroup`; null = all rows |
| Model field | `packages/core/src/models/curated-view.model.ts:28` | `FilterExpressionSchema.nullable()`; its comment already points at #644 |
| Request bodies | `packages/core/src/contracts/curated-view.contract.ts:115` (create), `:143` (update) | `.strict()` |
| Write validation | `apps/api/src/routes/curated-view.router.ts:77` (`validateFilter`) | limits (depth 4, 20 conditions) + operator/type compat → `CURATED_VIEW_INVALID_FILTER` |
| Dependency lock on write | `curated-view.router.ts:597` (POST), `:708` (PATCH) | `CuratedViewDependencyService.lockEntities` before validating |
| Filter-change read check | `curated-view.router.ts:714-727` | PATCH needs entity read when the filter changes (canonical-JSON compare) |
| Oracle masking | `services/curated-view-payload.service.ts:30` (`scopeRow`) | non-writers get `filter: null` |
| Route classification | `apps/api/src/__tests__/config/route-authorization.map.ts:709` (POST), `:542` (PATCH) | `locks: { none: … }` |

### Filter → SQL, and every place it runs

- `buildFilterSqlForEntity` (`apps/api/src/utils/filter-sql.util.ts:117`) resolves each field through `stmt.columnRefByNormalizedKey` to `"w"."c_*"`. `renderFilterGroupToSql` (`:143`) inlines literals with `formatLiteral` (`:164`), because view DDL can't bind parameters.
- Data lives in wide tables `er__<entityId>`. Column names are `c_<sanitized key>`, clipped to 63 bytes with collision suffixes (`services/wide-table-reconciler.service.ts:125`). The mapping is kept in `wide_table_columns` and cached (`wide-table-statement.cache.ts:78`). `json` maps to `jsonb`; `geometry` maps to `geometry(Geometry,4326)` with a GiST index.
- **One render choke point:** `renderViewFilterWhere` (`services/portal-sql.service.ts:447`). Its three consumers:

| Consumer | Location | Runs as |
|---|---|---|
| Session DDL (`resolveViewsForSession` → `buildViewsForSession`) | `portal-sql.service.ts:883`, `:909`, DDL `:940-967` | **reader role**, read-only txn, 30s `statement_timeout` (`openSqlSession`, `:190`) |
| `queryViewRowsByColumn` | `portal-sql.service.ts:484` | API role |
| `queryCuratedViewRecords` (records list, #649 keyset) | `portal-sql.service.ts:557`; count fingerprint includes `view.updated` (`:799`) | **API role** |
| Map tiles / dissolve | `portal-map-tile.service.ts:1151,1201` via `resolveViewsForSession`; cache keyed by `resolveScopeHash` (`portal-sql.service.ts:149`, hash of DDL) | reader role |

The API-role consumers matter. A spliced fragment there runs with the API's privileges, so the validator is the only boundary on those paths.

### The agent-SQL sandbox we can reuse

- `validatePortalSql` (`services/portal-sql-validation.util.ts:152`) runs a regex deny-list and then an AST gate.
- `parsePortalSql` (`services/portal-sql-parse.util.ts:238`) collects relations, functions and a `hasSubquery` flag.
- Allow-lists: `PORTAL_SQL_ALLOWED_FUNCTIONS` (`:284`) and `POSTGIS_ALLOWED_FUNCTIONS` (`:458`), enforced by `assertFunctionsAllowed` (`:610`).
- **The closest precedent is fragment validation.**
  - `parsePortalSqlExpression(fragment, "where")` (`:655`) fences the fragment as `SELECT 1 FROM __source WHERE TRUE AND (<fragment>)`.
  - It then runs `assertScalarOver` (`:815`: no subquery, no other relation), the function allow-list, and `assertAndOfTwo`/`assertConjunction` (`:718`, `:734`), which prove the fragment can't escape its parentheses.
  - Used by `tools/transform-entity-records.tool.ts:345`; re-checked before execution in `services/bulk-transform.service.ts:41-95`.
- **Gaps for #644:**
  - **Column refs:** the parser does **not** collect `ColumnRef`s, so nothing proves "only this entity's columns".
  - **Operators and casts:** `A_Expr` operators and `TypeCast` targets are not allow-listed.

### View-dependency lock (#802)

- `CuratedViewDependencyService` (`services/curated-view-dependency.service.ts`):
  - `lockEntities` (`:47`) takes an advisory xact lock per entity.
  - `findViewsUsingMappings` (`:62`) counts a view as dependent if it projects the mapping, or if `collectFilterFields(view.filter)` (`:121`, `filter.contract.ts:166`) names the mapping's key.
- 409s: `FIELD_MAPPING_DELETE_IN_VIEW` (`:128`) and `FIELD_MAPPING_KEY_IN_VIEW` (`:157`).
- Callers:
  - mapping delete: `field-mapping-validation.service.ts:168,272`
  - key rename: `:50`, reached from `routes/field-mapping.router.ts:816` and `tools/field-mapping-update.tool.ts:176`
  - layout-plan commit: `layout-plan-commit.service.ts:560-663`
  - impact endpoint: `field-mapping.router.ts:999`

### Web, LLM and entitlement precedents

- **Editor dialog.** `CuratedViewEditorDialog.component.tsx` holds `CuratedViewEditorUI` (`:45`) and `EditorContainer` (`:262`). It renders `AdvancedFilterBuilder` under "Row filter" (`:220`). Builder columns come from `sdk.entityRecords.list` (`:316`).
- **No row preview exists in the editor.** `OverlapPreview` is unrelated.
- **REST-connector precedent** (`RestApiConnectorWorkflow.component.tsx:336-527`):
  - UI: `TransformSuggester` sits beside `TransformEditor` and `PreviewPane`.
  - Endpoints: `POST /api/connector-instances/suggest-transform` and `/preview-endpoint-page` (`api/api-connector.api.ts:184,207`), both declaring `LONG_WRITE_TIMEOUT_MS`.
  - Server (`connector-instance.router.ts:1196`): checks write, calls Haiku 4.5 through `AiService`, validates the output against the sample, retries once, and returns 502 on a model failure.
  - **No one-shot LLM endpoint is metered.** That covers jsonata-suggest, the classifier and layout-plan interpret. `CostGateService` covers agent tools only (`services/cost-gate.service.ts:143,232`).
- **Entitlements** are boolean columns on `tiers` (`db/schema/tiers.table.ts:61-65`; `customRbac` precedent in migration `0108_add_tiers_custom_rbac.sql`). Adding one touches:
  - `TierEntitlementsSchema` (`packages/core/src/models/tier.model.ts:70`)
  - `TierService` (`services/tier.service.ts:60`)
  - `TIER_CATALOG` (`packages/core/src/registries/tier-catalog.ts`)
  - `CONVERGED_POLICY_FIELDS` (`packages/devops-cli/src/commands/tier.ts:62`)
  - the devops-cli mirror table (`packages/devops-cli/src/tables.ts:56`)

  Server enforcement precedents are `EntitlementService.customRbacEntitled` (`services/entitlement.service.ts:164`) and `TOOLPACK_NOT_ENTITLED` (`routes/toolpacks.router.ts:410`). On the web, `useActionGate().entitled(key)` (`apps/web/src/utils/use-action-gate.util.ts:51`) fails closed and yields an upsell.

## The design space

### Decision 1 — Storage shape

- **A. New `filter_sql` text column**, mutually exclusive with `filter` (DB `CHECK (filter IS NULL OR filter_sql IS NULL)`), plus `filter_sql_keys text[]` holding the referenced keys the validator extracted.
- **B. Widen the `filter` jsonb** into a union: `FilterGroup | { kind: "sql", sql, keys }`.
- **C. Store the parsed AST** instead of text.

| | A | B | C |
|---|---|---|---|
| Existing `filter` readers unchanged | Yes | No: every `collectFilterFields` / render / compat site must branch | Yes |
| Exclusivity enforced in DB | Yes (CHECK) | Implicit | Yes |
| Hand-editable round-trip | Text as typed | Text as typed | Needs deparse, loses formatting |
| Contract shape | `filterSql?: string \| null` beside `filter` | discriminated union in one field | opaque |

**Lean: A.** The `FilterGroup` path keeps its type exactly, and the mode is "which column is non-null". The stored `filter_sql_keys` means the dependency service doesn't re-parse SQL in its lookup loop.

### Decision 2 — What identifiers the author writes

- **A. Normalized column keys** (`amount > cost`, `ST_DWithin(location, …)`). The server rewrites each `ColumnRef` to `"w"."c_*"` at render time through `columnRefByNormalizedKey`, which is what the builder already does.
- **B. Physical `c_*` names.** These leak clipping and collision suffixes into stored data, and break if the reconciler ever renames.

**Lean: A.** Keys are the user-facing vocabulary, the dependency lock speaks in keys, and the wide-table layout stays an implementation detail. Rendering re-parses the stored text and substitutes column refs. Open question 1 covers how.

### Decision 3 — The validator (the load-bearing piece)

The validator is a new `validateViewFilterSql(sql, columns)` built on `parsePortalSqlExpression(…, "where")`, with three layers.

1. **Static AST allow-list.** This is the security boundary, and it is pure.
   - Reused from the agent sandbox: the fence and conjunction proofs; no `SubLink`, `RangeVar` or `ParamRef`; the function allow-list (`PORTAL_SQL_ALLOWED_FUNCTIONS` ∪ `POSTGIS_ALLOWED_FUNCTIONS`).
   - New **ColumnRef walker:** unqualified, single-field refs only, each naming a key in this entity's resolved columns. No `*`, no qualified names, no system columns.
   - New **operator allow-list** for `A_Expr`, `BoolExpr`, `NullTest` and `BooleanTest`:
     - comparison
     - `LIKE`/`ILIKE`
     - `IN`, `BETWEEN`
     - arithmetic
     - JSON `-> ->> #> #>> @> <@ ? ?| ?&`
     - regex `~ ~*` (bounded by the statement timeout)
     - PostGIS `&& <->`
   - New **`TypeCast` target allow-list:** scalar types, `geography`, `geometry`, `jsonb`, `date`, `timestamptz`.
   - Limits: at most 4,000 characters and a bounded AST node count.
2. **DB dry-run.** This checks correctness, not security. It runs `SELECT 1 FROM "er__<id>" w WHERE … LIMIT 0` under the reader role in a read-only txn with a short timeout. It catches type errors, non-boolean results ("argument of WHERE must be type boolean") and wrong function signatures that the static layer can't see.
3. **Re-validation at render.** `renderViewFilterWhere` re-runs layer 1 on every render and fails closed, so a stored fragment is never trusted just because it was valid when written.

**Decided: all three, plus the restricted role on every execution path (Decision 3a).** Layer 1 is the boundary. Layer 2 turns runtime 500s into authoring-time errors. Layer 3 is cheap: one WASM parse, memoizable on `(view.id, view.updated)`.

### Decision 3a — Every view read runs as the restricted role (decided)

Today `queryCuratedViewRecords` and `queryViewRowsByColumn` run on `er__` directly as the **API role**. **Decided:** both move into `openSqlSession`:
- reader role
- read-only txn
- 30s `statement_timeout`

Each one reads the **caller's own session temp view**, the one `resolveViewsForSession` builds, rather than `er__`. This makes the user's permissions the hard boundary, independent of the validator:

- **Columns:** the temp view already projects only the `c_*` columns this caller may read. A fragment naming an unreadable column fails, because the column isn't in the view.
- **Other entities and orgs:** the reader role holds `SELECT` only on this session's temp views. A cross-table or cross-org reference has nothing to reach, even if layer 1 had a hole.
- **Row scope:** the org and soft-delete guards plus the view's own filter are baked into the view DDL.

This applies to **every** curated view, not just SQL-filtered ones, so there is one execution path to secure rather than two.

**Spec must resolve:**
- **Paging columns.** The records query keyset-pages on `r."created"`, joined from `entity_records` (`portal-sql.service.ts:688-714`), to use the `(connector_entity_id, created, id)` index. The temp view therefore has to expose `created` (and the sort tiebreaker) itself, or join `entity_records` inside its DDL.
- **Performance.** #649's measured plans must hold once the query goes through the inlined view.
- **Error codes.** The reader role's fail-closed 503 joins the records endpoint's error contract.

### Decision 4 — LLM-assisted authoring

- **A.** `POST /api/curated-views/suggest-filter { connectorEntityId, prompt, currentSql? }` → `{ sql, warning? }`. It calls Haiku 4.5 through `AiService`, puts the output through the full validator (layers 1+2), retries once with the validator's error, and returns 502 when the model fails. This mirrors suggest-transform.
- **B.** Route the request through the portal agent.

**Lean: A.** It's one-shot, with the same shape as the precedent and no session state. The prompt carries column **keys and types only**, never row values; open question 3 asks whether to send samples. **No metering:** that matches every one-shot LLM endpoint today, and the tier entitlement is the paid axis (capability tiering). It still runs behind the API rate limiter.

### Decision 5 — Live sample preview

`POST /api/curated-views/preview-filter { connectorEntityId, filterSql, fieldMappingIds? }` returns the first 25 rows. Two options for running it:

- **A.** Run through `openSqlSession` as the reader role with the 30s timeout, on a temp view built exactly like the session DDL.
- **B.** Run through the API-role records query.

**Lean: A**, consistent with Decision 3a. The preview executes text that hasn't been saved, so it gets the strongest sandbox. It returns rows plus `hasMore`, but **no total count**, because an unbounded `count(*)` behind a typing user is a pool hazard (#698). The caller needs entity read; each `c_*` column is projected under the same column readability as the records list. It is POST because it carries a body, but it's a read: `locks: none`.

### Decision 6 — Entitlement and authorization

- **Entitlement.** A new `tiers.advanced_view_filters boolean NOT NULL DEFAULT false` column, wired through every surface listed under "Web, LLM and entitlement precedents" above.
- **Tiers (decided):** **pro** and **enterprise** get it (`TIER_CATALOG`); standard and plus don't. The backfill migration sets it for existing pro and enterprise tier rows, and `portalops tier apply` converges it.
- **Server enforcement.** A 403 `CURATED_VIEW_SQL_FILTER_NOT_ENTITLED` on:
  - create or PATCH that **sets or changes** `filterSql`
  - suggest-filter
  - preview-filter
- **Downgrade.** Clearing `filterSql` (returning to the builder) never needs the entitlement. Existing advanced views keep resolving after a downgrade (read side unchanged), per the PRD.
- **Authorization** is the existing view write check, plus entity read when `filterSql` changes, mirroring `:714-727`. `scopeRow` masks `filterSql` (and `filterSqlKeys`) to `null` for non-writers.

**Lean: as stated.** Order is permission, then tier, then state, so a non-writer never learns about the upsell.

### Decision 7 — Column pinning

Generalize `collectFilterFields` into a view-level `collectViewFilterFields(view)` that returns the `FilterGroup` fields or `filter_sql_keys`. Swap it in at `curated-view-dependency.service.ts:121`. All existing callers (mapping delete, key rename, commit reconcile, impact endpoint) inherit it unchanged. **Lean: this.** Keys are extracted by the same validator that stores them, so they can't drift from the SQL.

## Tradeoff comparison

| | D1 A (column) | D2 A (keys) | D3 3-layer | D4 A (suggest) | D5 A (reader preview) | D6 bool entitlement | D7 generalize collector |
|---|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| New contract | `filterSql` field | — | error codes | endpoint | endpoint | entitlement key | — |
| Packages | core, api | api | api | api, web | api, web | core, api, devops-cli, web | core, api |

## Recommendation

1. Add `curated_views.filter_sql text` and `filter_sql_keys text[]`, with a CHECK making `filter_sql` and `filter` mutually exclusive. Add `filterSql`/`filterSqlKeys` to the model, and `filterSql` (max 4,000 characters) to the strict create/update bodies.
2. Author in normalized column keys. Store the text as typed and rewrite `ColumnRef`s to `"w"."c_*"` at render.
3. Implement `validateViewFilterSql` on `parsePortalSqlExpression`, adding the ColumnRef walker, operator allow-list and cast allow-list. It returns `{ keys }`, or a typed `CURATED_VIEW_INVALID_FILTER_SQL` with the rejected node and a position.
4. Dry-run every written or suggested fragment under the reader role in a read-only txn before accepting it.
5. Re-validate inside `renderViewFilterWhere` on every render (memoized by `view.id` + `view.updated`), failing closed.
5a. Move `queryCuratedViewRecords` and `queryViewRowsByColumn`, for **all** views, into a reader-role `openSqlSession` reading the caller's own session temp view. Expose the keyset paging columns on that view, and re-verify #649's plans.
6. Add `POST /api/curated-views/suggest-filter` (Haiku 4.5, validated, one retry, unmetered, keys+types only) and `POST /api/curated-views/preview-filter` (reader-role session, 25 rows + `hasMore`, no count). Classify both in the route-authorization map and register their OpenAPI components.
7. Add a `tiers.advanced_view_filters` entitlement, granted to pro and enterprise, with fail-closed server checks. On the web, the mode switch uses `useActionGate` with an upsell.
8. Generalize `collectFilterFields` to the view level so SQL-filter keys are pinned by #802's lock.
9. Web: add a "Builder | SQL" mode switch in `CuratedViewEditorUI`. The SQL mode has an editor, a "Suggest" prompt and a preview pane. Switching modes asks to discard the other mode's filter.
10. Update docs: a glossary entry ("advanced filter"), an FAQ entry and Help copy. The agent prompt is unchanged, since views stay transparent temp views.

## Open questions

1. **Render-time identifier rewrite: deparse or splice by location?** libpg-query 17 exposes a deparser, but its output reformats the SQL, and deparse fidelity for PostGIS/JSON operators is unproven here. The alternative splices replacements at each `ColumnRef`'s `location` offset in the original text. **Lean: location splice**, because it's deterministic, preserves the author's text, and re-validation (layer 3) runs on the spliced result's parse anyway. **Agreed: prove it in the plan's first slice.** That slice gets a test matrix over PostGIS, JSON, cast and quoted-identifier fragments, and falls back to deparse if splicing can't hold.
2. **Should the suggester see sample values?** Values improve JSON-path suggestions (field names inside `payload`), but they send row data off-box. **Lean: keys + types, plus the top-level JSON key names from up to 20 rows** (structure only, never values). Record it as an egress change in `DEPLOYMENT_SECURITY_REVIEW.md`.
3. **Is regex (`~`) worth allowing?** Postgres regex is not catastrophic-backtracking-free, but every execution path has a statement timeout. **Lean: allow**, since it's bounded by the timeout and the issue names regex as a gap.
4. **Are the `locks: none` reasons for curated views stale?** Dissolve precompute reads views. **Lean: out of scope.** Fix the wording only if the new routes' classification touches it.

## Enterprise-scale considerations

- **Concurrency & correctness.**
  - Lean: write-time validation and the dependency check run under the existing `lockEntities` advisory lock, so a mapping delete can't interleave between "keys extracted" and "row written".
  - Render-time re-validation closes the window where a stored fragment's columns change.
  - Every read runs under the caller's reader-role session, so a validator gap still can't cross a permission boundary (Decision 3a).
- **Accuracy & auditability.** Lean: the stored text *is* the record of what a view filters. `filter_sql_keys` is derived from it and never edited independently. No separate audit log beyond the existing `updated`/`updatedBy`.
- **Failure modes.**
  - **Fail closed everywhere on the security path:** an unparsable or now-invalid fragment renders nothing, and the view surfaces "filter needs repair" instead of widening to all rows.
  - The dry-run fails closed (rejects) if the DB is unavailable.
  - The suggester fails soft: a 502 leaves hand-editing and save fully usable, as the PRD's degraded state requires.
- **Scale & unbounded growth.**
  - Lean: bounded fragment size and node count.
  - The preview returns no count and is capped at 25 rows under the 30s timeout.
  - Spatial filters should hit the GiST index: `ST_DWithin` on `geometry` is indexable, and casting to `geography` for miles isn't. The suggester prompt should prefer indexable forms; flagged in the spec.
- **Multi-tenancy.**
  - Lean: the org and soft-delete guards stay ANDed *outside* the fenced fragment, and the fence proof guarantees the fragment can't escape them.
  - No relation refs means no cross-table or cross-org reads.
  - Preview and suggest are per-org and behind the API rate limiter.
- **Contract stability.** Lean: `filterSql` sits beside `filter` rather than overloading it, so a later mode (e.g. dynamic `current_user.*` filters, out of scope) can be another sibling. The entitlement is a column, like its precedents.
- **Data lifecycle.**
  - Lean: no new retention. The SQL lives and dies with the view row.
  - Entity delete already tombstones its views (#802).
  - On a tier downgrade, stored filters keep working rather than being destroyed.

## What this doesn't decide

- Dynamic / `current_user.*` filters (out of scope per the issue).
- An agent tool for authoring advanced filters (dialog-only by PRD decision).
- Metering the suggester. Deferred until one-shot LLM endpoints get a shared metering decision; doing it for one endpoint would be inconsistent.
- Fixing the possibly stale `locks: none` reasons on the existing curated-view routes (open question 4).

## Next step

`/spec 644` writes `docs/ADVANCED_CURATED_VIEW_SQL_FILTER.spec.md`. It pins the column and contract shape, the exact operator, cast and function allow-lists, error codes, both endpoints, and the adversarial probe classes for the validator. `/plan 644` then slices it roughly as:

1. Validator plus its adversarial unit suite (pure, and the riskiest piece first).
2. Schema, model, contract and entitlement columns.
3. Write path, dry-run and dependency pinning.
4. Render integration across all four consumers, with re-validation, and the move of the records and rows-by-column queries onto the reader-role session.
5. The preview and suggest endpoints.
6. The web mode switch, editor and preview.
7. Docs surfaces.
