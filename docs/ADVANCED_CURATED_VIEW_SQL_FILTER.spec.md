# Advanced curated-view SQL filter — Spec

**Issue:** [EnterpriseBT/portal-ai#644](https://github.com/EnterpriseBT/portal-ai/issues/644) · **Discovery:** `docs/ADVANCED_CURATED_VIEW_SQL_FILTER.discovery.md`

This spec pins the contract for the opt-in **advanced (SQL) row filter** on curated views:
- the `filter_sql` storage
- the validator and the render-time identifier rewrite
- moving every curated-view read onto the caller's reader-role session
- the preview and suggest endpoints
- the `advancedViewFilters` tier entitlement
- column pinning
- the editor's Builder | SQL mode

## Key decisions (flag for review)

1. **Correction to discovery 3a: how the restricted role bounds a filter.** A temp view's body reads its relations with the **view owner's** privileges. The owner is the API role, which creates the DDL before `SET LOCAL ROLE`. Reading a view as the reader role therefore would *not* bound a fragment inside an ordinary view body. This spec closes that gap with a **two-view session shape**, specified in "Session view shape":
   - **Source view.** A server-built `__src_<n>` temp view, with no user text, holds the org and soft-delete guard over `er__<id>`.
   - **Curated view.** The curated temp view is declared `WITH (security_invoker = true)`, so its body, including the fragment, runs with the **reader role's** privileges.
   - **Grants.** The reader role gets column-level `SELECT` only on the `__src_<n>` columns the view projects or filters on.

   So relations, columns and functions are all bounded by the role. A fragment naming `er__…`, `organizations` or a column outside that set fails in Postgres even if the static validator had a hole. Postgres 17 (`imresamu/postgis:17-3.5-alpine`, `docker-compose.yml:64`) supports `security_invoker`.
2. **Column semantics stay the FilterGroup's.** The author's filter may reference any of the entity's columns: writing a filter needs entity read (#829), and entity read covers every column. The viewer receives only the view's projection ∩ their readable columns. Filtering on a column the viewer can't see is the curated-view model as it exists today. `scopeRow` keeps the filter text away from non-writers, so it can't be used to learn hidden values.
3. **Every curated-view read moves to the reader role** (discovery 3a): the records list, rows-by-column, preview, dry-run, agent session and tiles. That's one execution path for every view, not only SQL-filtered ones.
4. **Mode is "which column is non-null".** `filter` and `filter_sql` are mutually exclusive (DB `CHECK`). Setting either one clears the other.
5. **Authors write column keys.** Each `ColumnRef` is spliced by byte location into `w."c_*"` at render. The plan's slice 1 proves this, and falls back to the parser's deparse if splicing can't hold (discovery open question 1).
6. **The suggester sees column keys and types, plus the top-level JSON key names from up to 20 rows** (structure only, never values). Regex (`~`, `~*`) is allowed. Discovery open questions 2–3 were accepted as leaned.
7. **One broken view never breaks a session.** Each SQL-filtered view's DDL is created under a `SAVEPOINT`. If it fails (e.g. a referenced column's *type* changed, which pinning doesn't cover), that view is created as `WHERE FALSE` and logged, and the records endpoint answers `409 CURATED_VIEW_FILTER_SQL_BROKEN`. This fails closed, per view.
8. **Entitlement on pro and enterprise, converged by `portalops tier apply`.** There is no data migration: a tier's policy fields are catalog-owned (`SeedService` only bootstraps `standard`, `seed.service.ts:380-418`).

## Scope

### In scope

1. `curated_views.filter_sql` and `filter_sql_keys` columns, the model fields and the contract fields.
2. `validateViewFilterSql` and `renderViewFilterSql` in `apps/api/src/services/curated-view-filter-sql.util.ts`.
3. `CuratedViewFilterSqlService`: dry-run, preview and suggest orchestration.
4. The two-view session shape in `buildViewsForSession`, plus a single-view session builder for the records list, rows-by-column and preview.
5. Moving `queryCuratedViewRecords` and `queryViewRowsByColumn` onto the reader-role session.
6. `POST /api/curated-views/filter-sql/preview` and `POST /api/curated-views/filter-sql/suggest`.
7. The `advancedViewFilters` entitlement across core, api, devops-cli and web.
8. Pinning SQL-filter keys through `CuratedViewDependencyService`.
9. Web: the Builder | SQL mode, `FilterSqlEditor`, `FilterSqlPreview`, and the SDK endpoints.
10. Docs: glossary, FAQ, `DEPLOYMENT_SECURITY_REVIEW.md` egress.

### Out of scope

- Dynamic / `current_user.*` filters.
- An agent tool for authoring advanced filters.
- Metering the suggester.
- Pinning column **type** changes (handled by the per-view degrade instead; Key decision 7).
- Rewording the existing curated-view routes' `locks: none` reasons.

## Surface

### Storage — `apps/api/src/db/schema/curated-views.table.ts`

Add these columns after `filter` (`:33`):

```ts
/** #644: advanced row filter — a validated SQL boolean fragment over the
 *  entity's column keys, as typed. Mutually exclusive with `filter`. */
filterSql: text("filter_sql"),
/** #644: the column keys `filter_sql` references, extracted by the validator
 *  at write. Derived — never written independently. Empty when no SQL. */
filterSqlKeys: text("filter_sql_keys").array().notNull().default(sql`'{}'::text[]`),
```

Add one table check:

```ts
check("curated_views_filter_mode_exclusive", sql`filter IS NULL OR filter_sql IS NULL`)
```

### Model — `packages/core/src/models/curated-view.model.ts`

`CuratedViewSchema` gains two fields:
- `filterSql: z.string().nullable()`
- `filterSqlKeys: z.array(z.string())`

`filterSqlKeys` is required, so every creation site must set it: the router create, `CuratedViewModelFactory` callers and fixtures. drizzle-zod and the `type-checks.ts` bidirectional guards follow.

### Contract — `packages/core/src/contracts/curated-view.contract.ts`

```ts
export const FILTER_SQL_MAX_LENGTH = 4000;
export const filterSqlField = () =>
  z.string().trim().min(1, "Filter is required").max(FILTER_SQL_MAX_LENGTH,
    `Filter must be at most ${FILTER_SQL_MAX_LENGTH} characters`);
```

**Create and update bodies** (`:115`, `:143`):
- Both gain `filterSql: filterSqlField().nullable().optional()`.
- Both get a `.superRefine` after `.strict()`: `filter` and `filterSql` may not both be non-null. The error lands on `filterSql` with the message "Use either the builder filter or a SQL filter, not both".

**Server semantics:**
- A body that sets `filterSql` to a string writes `filter = null`.
- A body that sets `filter` to a group writes `filter_sql = null` and `filter_sql_keys = '{}'`.

**New request and response schemas:**

```ts
export const CuratedViewFilterSqlPreviewRequestBodySchema = z.object({
  connectorEntityId: z.string().min(1),
  filterSql: filterSqlField(),
  /** Editing an existing view: authorizes by its write instead of create. */
  curatedViewId: z.string().min(1).optional(),
  fieldMappingIds: z.array(z.string()).optional(),
}).strict();
export const CuratedViewFilterSqlPreviewResponsePayloadSchema = z.object({
  columns: z.array(ResolvedColumnSchema),
  records: z.array(z.record(z.string(), z.unknown())),   // keyed by normalizedKey, + _record_id
  hasMore: z.boolean(),
});
export const CuratedViewFilterSqlSuggestRequestBodySchema = z.object({
  connectorEntityId: z.string().min(1),
  prompt: descriptionField(),               // ≤ 2000, required
  currentSql: z.string().max(FILTER_SQL_MAX_LENGTH).optional(),
  curatedViewId: z.string().min(1).optional(),
}).strict();
export const CuratedViewFilterSqlSuggestResponsePayloadSchema = z.object({
  filterSql: z.string(),
  warning: z.string().nullable(),
});
```

`strict-request-bodies.test.ts` covers all of these automatically.

### Validator and render — `apps/api/src/services/curated-view-filter-sql.util.ts` (new)

```ts
export interface FilterSqlColumnRef { key: string; byteStart: number; byteEnd: number }
export interface ValidatedFilterSql { keys: string[]; refs: FilterSqlColumnRef[] }

/** Throws ApiError(400, CURATED_VIEW_INVALID_FILTER_SQL, message, { position? }). */
export function validateViewFilterSql(
  sql: string,
  columnKeys: ReadonlySet<string>
): ValidatedFilterSql;

/** Re-validates, then splices each ref → `w.<quoteIdent(columnName)>`. Throws
 *  ApiError(500, CURATED_VIEW_FILTER_SQL_BROKEN) on any failure (fail closed). */
export function renderViewFilterSql(
  sql: string,
  columnNameByKey: ReadonlyMap<string, string>
): string;

/** Exported for the audit test. */
export const FILTER_SQL_ALLOWED_NODES: ReadonlySet<string>;
export const FILTER_SQL_ALLOWED_OPERATORS: ReadonlySet<string>;
export const FILTER_SQL_ALLOWED_CAST_TYPES: ReadonlySet<string>;
```

**`validateViewFilterSql` steps, in order** (the first failure throws, naming the rejected construct):

1. **Shape.** Run `parsePortalSqlExpression(sql, "where")` (`portal-sql-parse.util.ts:655`). That gives the fence, `assertScalarOver` (no subquery, relation or schema-qualified name), `assertFunctionsAllowed` (`PORTAL_SQL_ALLOWED_FUNCTIONS` ∪ `POSTGIS_ALLOWED_FUNCTIONS`) and `assertAndOfTwo` (the fragment can't escape its parentheses). Its `PORTAL_SQL_FORBIDDEN` is re-thrown as `CURATED_VIEW_INVALID_FILTER_SQL`.
2. **Node-kind allow-list.** Walk the fragment's subtree, i.e. the second argument of the wrapper's top-level `AND`. Every node kind must be in `FILTER_SQL_ALLOWED_NODES`: `A_Expr`, `BoolExpr`, `NullTest`, `BooleanTest`, `A_Const`, `ColumnRef`, `FuncCall`, `TypeCast`, `TypeName`, `CaseExpr`, `CaseWhen`, `CoalesceExpr`, `NullIfExpr`, `MinMaxExpr`, `A_ArrayExpr`, `List`, `String`, `Integer`, `Float`, `Boolean`. Anything else is rejected, including `SubLink`, `ParamRef`, `A_Star`, `A_Indirection`, `RowExpr`, `CollateClause`, `GroupingFunc`, `SQLValueFunction` and `XmlExpr`.
3. **`FuncCall` constraints.** No `over`, `agg_filter`, `agg_order`, `agg_star` or `agg_distinct`. The name may not be in `AGGREGATE_FUNCTIONS`.
4. **`A_Expr` constraints.**
   - **Allowed kinds:** `AEXPR_OP`, `AEXPR_IN`, `AEXPR_LIKE`, `AEXPR_ILIKE`, `AEXPR_BETWEEN`, `AEXPR_NOT_BETWEEN`, `AEXPR_DISTINCT`, `AEXPR_NOT_DISTINCT`, `AEXPR_OP_ANY`.
   - **`AEXPR_OP`:** a single unqualified name in `FILTER_SQL_ALLOWED_OPERATORS`: `= <> != < <= > >= + - * / % || ~ ~* !~ !~* -> ->> #> #>> @> <@ ? ?| ?& && <->`.
5. **`TypeCast` target** must be one unqualified name in `FILTER_SQL_ALLOWED_CAST_TYPES`: `text`, `varchar`, `int2`, `int4`, `int8`, `numeric`, `float4`, `float8`, `bool`, `date`, `timestamp`, `timestamptz`, `interval`, `jsonb`, `json`, `geometry`, `geography`, `uuid`. The parser resolves `integer`/`bigint`/… to their `pg_catalog` names before this comparison.
6. **`ColumnRef`.** Exactly one `String` field, which is a key in `columnKeys`; no `A_Star`. Its `location` is converted into a byte range on the fragment:
   - `location` is a **UTF-8 byte offset into the wrapped statement**. Subtract the wrapper prefix's byte length.
   - Measure the token extent with an identifier scanner: a quoted `"…"` (including `""` escapes) or an unquoted `[A-Za-z_][A-Za-z0-9_$]*`.
7. **Limits.** At most 200 AST nodes (counted in step 2).

The result is `keys` (unique, sorted) and `refs`, sorted by `byteStart`.

**`renderViewFilterSql` steps:**
1. Validate again.
2. Splice the refs right-to-left on the UTF-8 buffer.
3. Re-parse the spliced text as `SELECT 1 FROM w WHERE TRUE AND (<spliced>)`.
4. Assert every `ColumnRef` is now the two-field `w.<known columnName>`, and that steps 2–5 still hold.

The result is memoized per `(viewId, updated)` in a bounded LRU of 500 entries.

### Session view shape — `apps/api/src/services/portal-sql.service.ts`

`buildViewsForSession` (`:909`) changes for each granted view whose `filterSql` is set. FilterGroup views keep their single-view DDL; only the projection-column grant changes.

```sql
CREATE TEMP VIEW "__src_<n>" AS
  SELECT w."entity_record_id", w."source_id", w.<c_* projected ∪ filter-referenced>
  FROM "er__<entityId>" w
  WHERE w."organization_id" = '<org>' AND w."deleted" IS NULL;
CREATE TEMP VIEW "<view.key>" WITH (security_invoker = true) AS
  SELECT w."entity_record_id" AS "_record_id", '<entityId>'::text AS "_connector_entity_id",
         w."source_id" AS "source_id", w.<c_* projected>
  FROM "__src_<n>" w
  WHERE (<renderViewFilterSql(...)>);
```

- **Grants.** `PortalSqlReaderRoleService.enter` (`portal-sql-reader-role.service.ts:86`) gains an optional `columnGrants: Array<{ view: string; columns: string[] }>`, issued as `GRANT SELECT (<cols>) ON "__src_<n>" TO <reader>`. `__src_<n>` is **not** added to `viewMap`, so agent SQL's relation allow-list still refuses it by name.
- **Per-view isolation.** Each SQL view's pair is created inside a `SAVEPOINT`. On error it rolls back to the savepoint, the view becomes `SELECT … WHERE FALSE` over `er__` (same projection), and the service logs `curated view filter_sql failed to apply` with the view id and pg code.
- **Tile and dissolve hashing.** `resolveScopeHash` (`:149`) hashes the DDL, so tile and dissolve caches re-key automatically.

**Single-view session builder** (new, private):

```ts
private async buildSingleViewSession(
  view: CuratedViewSelect | DraftView,          // DraftView = { connectorEntityId, filterSql, filter: null }
  columns: WideTableCachedColumn[],             // the caller's readable projection
  organizationId: string,
  opts: { exposeCreated: boolean; client: DbClient }
): Promise<SessionViewBuild>                    // one view named "__view", same two-view shape for SQL
```

When `exposeCreated` is set, `__src` also joins `entity_records r ON r.id = w.entity_record_id AND r.connector_entity_id = '<id>' AND r.deleted IS NULL` and projects `r."created" AS "_created"` and `r."id" AS "_er_id"`.

**`queryCuratedViewRecords`** (`:557`) and **`queryViewRowsByColumn`** (`:484`):
- Each wraps its work in a transaction: `PortalSqlReaderRoleService.assertUsable()` (*before* opening the transaction), then `openSqlSession(tx, build, { statementTimeoutMs: STATEMENT_TIMEOUT_MS })`.
- Their server-built outer `SELECT … FROM "__view" w` keeps today's search, `?filters`, sort, keyset and count logic, retargeted to the view's columns (`w."_record_id"`, `w."_created"`, `w."_er_id"`).
- Signatures and response shapes are unchanged.
- A reader-role outage answers the existing fail-closed `503`. A session SQL view that degraded answers `409 CURATED_VIEW_FILTER_SQL_BROKEN`, rather than serving the `WHERE FALSE` rows as if they were real.

`renderViewFilterWhere` (`:447`) dispatches on `view.filterSql` versus `view.filter`. It stays the single render point.

### `CuratedViewFilterSqlService` — `apps/api/src/services/curated-view-filter-sql.service.ts` (new)

```ts
export class CuratedViewFilterSqlService {
  /** validate + LIMIT 0 run in a single-view reader session. Returns keys. */
  static async validateAndDryRun(connectorEntityId: string, organizationId: string,
    filterSql: string, client?: DbClient): Promise<{ keys: string[] }>;
  static async preview(params: { organizationId: string; userId: string;
    connectorEntityId: string; filterSql: string; fieldMappingIds?: string[] }):
    Promise<CuratedViewFilterSqlPreviewResponsePayload>;   // 25 rows, hasMore, no count
  static async suggest(params: { organizationId: string; connectorEntityId: string;
    prompt: string; currentSql?: string }): Promise<CuratedViewFilterSqlSuggestResponsePayload>;
}
```

**Dry-run.** A Postgres error from the dry-run is mapped to `400 CURATED_VIEW_INVALID_FILTER_SQL`, carrying the pg message (e.g. "argument of WHERE must be type boolean") and the position when it falls inside the fragment. If the database is unavailable, the dry-run rejects with `503`, failing closed.

**Suggest:**
- The suggester is `apps/api/src/services/curated-view-filter-suggest.haiku.ts` (new). It mirrors `adapters/rest-api/jsonata-suggest.haiku.ts`: `getFilterSqlSuggester()`, `__setFilterSqlSuggesterForTesting()`, and Haiku 4.5 by default through `AiService`.
- The prompt carries column `{key, type}` and the top-level JSON key names from up to 20 rows (read in a reader session). It also tells the model to prefer `ST_DWithin` on `geometry` (indexable) over a `geography` cast.
- Each output goes through `validateAndDryRun`. On failure it retries once, feeding back the validator's message, and then fails with `502 CURATED_VIEW_FILTER_SUGGEST_FAILED`.
- `warning` is set when the result needed the retry.

### Routes — `apps/api/src/routes/curated-view.router.ts`

**Create** (`:521`) and **PATCH** (`:670`). Inside the existing transaction, after `lockEntities`, when `filterSql` is **set or changed** (canonical compare against the stored text), these run in order:
1. **Permission.** Existing.
2. **Entity read.** As at `:714-727`, now also when `filterSql` changes.
3. **Entitlement.** `EntitlementService.advancedViewFiltersEntitled(org)`, else `403 CURATED_VIEW_FILTER_SQL_NOT_ENTITLED`.
4. **Validate.** `CuratedViewFilterSqlService.validateAndDryRun`.
5. **Write.** `filter_sql` and `filter_sql_keys`, with `filter = null`.

Clearing `filterSql` (to `null` or by switching to `filter`) needs no entitlement. An unchanged resend skips steps 2–4, so a downgraded org can still rename the view.

**New routes:**

| Method + path | Auth (in order) | Response | Errors |
|---|---|---|---|
| `POST /filter-sql/preview` | entity in org and readable (else 404); with `curatedViewId`, `loadForVerb(write)` on that view and its entity must match, else the create rule `{type: "curated_view", createdBy: userId}`; entitlement | `{ payload: PreviewResponse }` | `400 CURATED_VIEW_INVALID_PAYLOAD` / `_INVALID_FILTER_SQL`, `403 PERMISSION_DENIED` / `_FILTER_SQL_NOT_ENTITLED`, `404`, `503` |
| `POST /filter-sql/suggest` | same as preview | `{ payload: SuggestResponse }` | same, plus `502 CURATED_VIEW_FILTER_SUGGEST_FAILED` |

Both are declared **before** `/:id/attach` and both carry `@openapi` blocks referencing the components registered in `swagger.config.ts`. In `route-authorization.map.ts` they are classified "org-scoped entity read + view write/create + entitlement", with `locks: { none: "read-only: runs the fragment in a read-only reader session" }`.

**Masking.** `CuratedViewPayloadService.scopeRow` (`curated-view-payload.service.ts:30`) masks `filterSql: null` and `filterSqlKeys: []` for non-writers.

### `ApiCode` additions — `apps/api/src/constants/api-codes.constants.ts` (by `:585`)

`CURATED_VIEW_INVALID_FILTER_SQL`, `CURATED_VIEW_FILTER_SQL_NOT_ENTITLED`, `CURATED_VIEW_FILTER_SQL_BROKEN`, `CURATED_VIEW_FILTER_SUGGEST_FAILED`.

### Entitlement `advancedViewFilters`

| Surface | Change |
|---|---|
| `apps/api/src/db/schema/tiers.table.ts` | `advancedViewFilters: boolean("advanced_view_filters").notNull().default(false)` |
| `packages/core/src/models/tier.model.ts:70` | `advancedViewFilters: z.boolean()` in `TierEntitlementsSchema` |
| `apps/api/src/services/tier.service.ts:60` | map `row.advancedViewFilters` |
| `packages/core/src/registries/tier-catalog.ts` | `true` on `pro`, `enterprise`; `false` on `standard`, `plus` |
| `packages/devops-cli/src/commands/tier.ts:62` | add to `CONVERGED_POLICY_FIELDS` |
| `packages/devops-cli/src/tables.ts:56` | mirror column (parity test) |
| `apps/api/src/services/entitlement.service.ts` | `static advancedViewFiltersEntitled(organizationId): Promise<boolean>` |
| `apps/web/src/utils/use-action-gate.util.ts:14` | `EntitlementKey` widens automatically |

### Column pinning — `packages/core/src/contracts/filter.contract.ts` + dependency service

```ts
/** #644: every column key a view's row filter names — FilterGroup or SQL. */
export function collectViewFilterFields(view: { filter: FilterGroup | null;
  filterSqlKeys: readonly string[] }): Set<string>;
```

This replaces `collectFilterFields(view.filter)` at `curated-view-dependency.service.ts:121`, and the `if (!view.filter) return false` guard becomes an empty-set check. Every caller inherits it: mapping delete, key rename, the layout-plan commit reconcile and the impact endpoint.

### Web

- **SDK** (`apps/web/src/api/curated-views.api.ts`):
  - `previewFilterSql` and `suggestFilterSql` are `useAuthMutation` POSTs, both declaring `timeoutMs: LONG_WRITE_TIMEOUT_MS`.
  - No `onPermissionDenied`: they're fixed collection URLs, which the guard exempts.
  - Create and update bodies carry `filterSql`.
- **`components/FilterSqlEditor.component.tsx`** (pure UI, single component):

  ```ts
  interface FilterSqlEditorUIProps {
    value: string; onChange(v: string): void; onBlur(): void;
    error?: string; touched: boolean;                 // validation + server field error
    readOnly: boolean;                                // downgraded tier: stored SQL shown, not editable
    suggest: { prompt: string; onPromptChange(v: string): void; onSuggest(): void;
               pending: boolean; serverError: ServerError | null };
    preview: { onRun(): void; pending: boolean; serverError: ServerError | null;
               result: CuratedViewFilterSqlPreviewResponsePayload | null };
  }
  ```

  The editor is a monospace multiline `TextField` with `aria-invalid` / `helperText`, `required`, and no `maxLength`. "Suggest" and "Run preview" are `type="button"`.
- **`components/FilterSqlPreview.component.tsx`** (pure UI) has four states: loading, error (`FormAlert`), empty ("No rows match this filter"), and rows (≤25, with "More rows match" when `hasMore`).
- **`CuratedViewEditorUI`** (`CuratedViewEditorDialog.component.tsx:45`) gains a `filterMode: "builder" | "sql"` toggle above "Row filter" (`:220`):
  - The toggle is gated: without the entitlement the SQL option renders an `upsell` gate through `ActionSuiteItem`/`GatedButton`. A stored SQL filter on a downgraded org opens in SQL mode, read-only.
  - Both modes keep local state, and save sends only the active mode's value, with `null` for the other. Switching modes needs no confirm.
  - `validateWithSchema` against the create/update body schema; `focusFirstInvalidField`.
- **`EditorContainer`** (`:262`) wires the two mutations. It resets both on open and close, per R4. After a successful suggest it runs the preview once automatically.

### Docs

- `packages/core/src/content/glossary.util.ts`: an "Advanced filter" entry.
- `faq.util.ts`: "When should I use a SQL filter instead of the builder?"
- `docs/DEPLOYMENT_SECURITY_REVIEW.md` §1: the new data class sent to Anthropic (column keys and types, and JSON key names, never values).
- The agent prompt and tool descriptions are unchanged.

## Migration

`npm run db:generate -- --name add-curated-view-filter-sql-and-tier-entitlement` adds `curated_views.filter_sql`, `filter_sql_keys`, the `CHECK`, and `tiers.advanced_view_filters`. The migration is expand-only and needs no `destructive-ok`. Commit the `.sql`, `meta/_journal.json` and the snapshot together.

## Seed

There's no seed change. `TIER_CATALOG` is the source, and rollout is `portalops tier apply --env <env>`, which converges pro and enterprise. The standard bootstrap row reads the catalog (`false`). There's no per-org seed, so no backfill marker.

## TDD test plan

Tests run with `npm run test:unit` / `npm run test:integration` in each package.

### core — `packages/core/src/__tests__/`
- `contracts/curated-view.contract.test.ts`: `filterSql` max/trim/empty; both-set refused (create, update); strict unknown key; preview/suggest bodies. **≈10**
- `contracts/filter.contract.test.ts`: `collectViewFilterFields` covers group, SQL, both empty. **≈3**
- `registries/tier-catalog.test.ts`: pro and enterprise true, standard and plus false. **≈2**

### api unit — `apps/api/src/__tests__/services/curated-view-filter-sql.util.test.ts` (new)
- **Accept matrix:** comparison, `AND`/`OR`/`NOT`, `IN`, `BETWEEN`, `ILIKE`, regex, `IS NULL`, JSON `->>` / `@>` / `?`, `ST_DWithin(location, ST_SetSRID(ST_MakePoint(…),4326), 0.1)`, `::geography` cast, column-vs-column, `CASE`, `COALESCE`, comments, quoted identifiers. **≈16**
- **Reject matrix:**
  - escape: `) OR (TRUE`, `1=1) AND (x`, `;`
  - subqueries: `EXISTS (SELECT…)`, `IN (SELECT…)`
  - other relations: `er__x.c_a`, `organizations.id`
  - other names: `*`, a qualified ref, an unknown key
  - functions: a schema-qualified function, `pg_sleep`, `set_config`, `query_to_xml`, `current_setting`, `lo_import`, `dblink`
  - other constructs: an aggregate, a window function, `$1`, an array subscript, `COLLATE`, a disallowed cast (`regclass`), a disallowed operator
  - limits: over 4,000 characters, over 200 nodes; non-SQL garbage

  Each case asserts the code and the named construct. **≈28**
- **Splice matrix:** multibyte UTF-8 before a ref; a key that's a prefix of another key; a quoted `"key"`; a ref inside a JSON operator and inside a PostGIS call; a repeated ref; a ref inside a comment-adjacent line. The spliced output re-parses to only `w.<col>` refs. **≈8**
- **Audit:** the allow-lists have an empty intersection with a pinned list of relation-taking and privileged functions (`query_to_xml`, `table_to_xml`, `has_*_privilege`, `to_regclass`, `currval`, `nextval`, `setval`, `pg_read_file`, `lo_*`, `dblink*`, `set_config`, `current_setting`). **≈1**
- `services/curated-view-dependency.service.test.ts`: a SQL view pins its keys; rename and delete 409. **≈3**
- `services/curated-view-filter-suggest.haiku.test.ts`: the prompt carries keys, types and JSON key names, never values; model id wiring. **≈3**

### api integration — `apps/api/src/__tests__/__integration__/`
- `routes/curated-view.router.integration.test.ts`:
  - create and PATCH with `filterSql`: entitled; not entitled → 403; invalid → 400 with position; non-boolean → 400 from the dry-run
  - both set → 400; the switch to builder clears SQL; an unchanged resend on a downgraded org → 200
  - entity read required; `scopeRow` masks for a non-writer

  **≈12**
- `routes/curated-view-filter-sql.integration.test.ts` (new):
  - preview: rows, `hasMore`, empty, the create-vs-write authorization split, 404 for another org's entity, entitlement 403, statement timeout
  - suggest: suggester mocked, retry on a validator failure, 502

  **≈10**
- `services/portal-sql-view-session.integration.test.ts` (new), **the security suite:**
  - a spatial `ST_DWithin` view and a JSON-path view resolve the right rows
  - a viewer gets only projection ∩ readable columns
  - another org's rows are never returned
  - a fragment written straight into the DB (bypassing the validator) that names `organizations` or another `er__` fails at the **role**, and the view degrades to `WHERE FALSE`, not a widened one
  - agent SQL can't select `__src_<n>`
  - a broken view doesn't break the session's other views
  - the records list (keyset `created`, column sort, search, `?filters`, count) and rows-by-column return the same results as before through the reader session
  - a reader-role outage → 503

  **≈16**
- `routes/field-mapping.router.integration.test.ts`: delete and rename of a SQL-referenced column → 409. **≈2**
- The `route-authorization.map` guard picks up both new routes.

### devops-cli — `packages/devops-cli/src/__tests__/`
- The tables parity test, and the `tier apply` converge diff including `advancedViewFilters`. **≈2**

### web — `apps/web/src/__tests__/`
- `FilterSqlEditor.test.tsx`: renders; `aria-invalid` and `required`; error after blur only; read-only; Suggest and Run buttons call back; pending states. **≈8**
- `FilterSqlPreview.test.tsx`: loading, error, empty, rows, `hasMore`. **≈5**
- `CuratedViewEditorDialog.test.tsx` additions:
  - the mode toggle; upsell when not entitled
  - save sends the active mode only
  - Enter submits from the SQL field via `pressEnter`, never `fireEvent.submit`
  - can't close while pending
  - `FormAlert` for a server error, and the reset on reopen
  - downgraded org opens read-only

  **≈9**
- Stories: `FilterSqlEditor` and `FilterSqlPreview`.

**Totals ≈ 140 cases.**

## Acceptance criteria

- [ ] A pro or enterprise user with view write saves an `ST_DWithin` or JSON-path SQL filter. The view's records, the agent session and map tiles all return exactly the matching rows.
- [ ] A member granted the view sees only its rows and their readable projected columns. The filter text is hidden from them.
- [ ] Injection, cross-table, subquery, write, disallowed-function, disallowed-cast and non-boolean fragments are refused at save with `400 CURATED_VIEW_INVALID_FILTER_SQL`, naming the problem.
- [ ] A fragment that reaches the database without validation still can't read another relation or column: the reader role refuses it, and the view degrades to empty.
- [ ] Deleting or renaming a referenced column → `409 FIELD_MAPPING_DELETE_IN_VIEW` / `FIELD_MAPPING_KEY_IN_VIEW`.
- [ ] Standard and plus orgs see an upsell on the SQL mode and get `403 CURATED_VIEW_FILTER_SQL_NOT_ENTITLED` from the API. After a downgrade, existing SQL views keep resolving and open read-only.
- [ ] Suggest produces a validated, previewed filter. A suggester failure leaves hand-editing and save working.
- [ ] Preview shows the loading, error, empty and rows states, returns no total count, and is bounded by the 30s timeout.
- [ ] The builder path is unchanged for users who never open SQL mode, and the records list behaves the same for every existing view.

## Risks & rollback

- **The records list on the reader session (biggest risk).** This changes #649's measured query plans: the inlined view, and the `created` join inside `__src`. **Detect:** the plan slice records `EXPLAIN ANALYZE` against a 400K-row entity (a measurement, not a test assertion, per #442). **Rollback:** revert that slice. FilterGroup views were correct on the API role before.
- **`security_invoker` and column grants.** The risk is that these behave differently on RDS. **Detect:** app-dev smoke. Postgres 17 locally and on RDS.
- **Validator gap.** The role is the backstop for relation and column escape (Key decision 1), and `transaction_read_only` and the timeout bound side effects and cost. The failure is fail-closed: a degraded view returns zero rows, never a widened set.
- **Suggester egress.** Structure only, documented in the security review. The suggester fails soft.
- **Rollback overall.** The columns are additive. Reverting the code leaves `filter_sql` rows that old code ignores; old code renders `filter` (null), which would **widen** those views to all rows. So a rollback must first run `UPDATE curated_views SET deleted = now() WHERE filter_sql IS NOT NULL` (or set them to `WHERE FALSE`). This is documented in the PR.

## Files touched

- **core**
  - `models/curated-view.model.ts`
  - `models/tier.model.ts`
  - `contracts/curated-view.contract.ts`
  - `contracts/filter.contract.ts`
  - `registries/tier-catalog.ts`
  - `content/glossary.util.ts`
  - `content/faq.util.ts`
  - tests
- **api**
  - `db/schema/curated-views.table.ts`, `tiers.table.ts`, `zod.ts`, `type-checks.ts`
  - `drizzle/<n>_add-curated-view-filter-sql-and-tier-entitlement.sql` + meta
  - `services/curated-view-filter-sql.util.ts` (new)
  - `services/curated-view-filter-sql.service.ts` (new)
  - `services/curated-view-filter-suggest.haiku.ts` (new)
  - `services/portal-sql.service.ts`
  - `services/portal-sql-reader-role.service.ts`
  - `services/curated-view-dependency.service.ts`
  - `services/curated-view-payload.service.ts`
  - `services/entitlement.service.ts`
  - `services/tier.service.ts`
  - `routes/curated-view.router.ts`
  - `constants/api-codes.constants.ts`
  - `config/swagger.config.ts`
  - `__tests__/config/route-authorization.map.ts`
  - tests
- **devops-cli**
  - `commands/tier.ts`
  - `tables.ts`
  - tests
- **web**
  - `api/curated-views.api.ts`
  - `components/CuratedViewEditorDialog.component.tsx`
  - `components/FilterSqlEditor.component.tsx` (new)
  - `components/FilterSqlPreview.component.tsx` (new)
  - stories
  - tests
- **docs**
  - `DEPLOYMENT_SECURITY_REVIEW.md`

## Next step

`/plan 644` writes `docs/ADVANCED_CURATED_VIEW_SQL_FILTER.plan.md`, each slice a test-first commit on this branch. Roughly eight slices:

1. Validator and splice proof, with the reject, splice and audit suites (proves discovery open question 1).
2. Schema, model, contract and entitlement plumbing.
3. The two-view session shape with role grants and per-view isolation, plus the security suite.
4. Records list and rows-by-column on the reader session, with the plan measurement.
5. The write path, dry-run, masking and pinning.
6. The preview and suggest endpoints.
7. The web mode, editor and preview.
8. Docs.
