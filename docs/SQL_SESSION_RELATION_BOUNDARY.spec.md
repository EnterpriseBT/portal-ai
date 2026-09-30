# SQL session relation boundary — Spec

This spec pins the contract that makes an agent SQL session able to read **exactly** the caller's granted views and nothing else. It covers two PRs under [#660](https://github.com/EnterpriseBT/portal-ai/issues/660):
- **PR 1, the hotfix:** a `libpg-query` AST gate, replacing `node-sql-parser`; temp-view hygiene; persisted-pipeline re-validation; `transform_entity_records` fragment rules.
- **PR 2, the database role:** a restricted NOLOGIN reader role, a migration-only connection, and a fail-closed self-check.

PR 1 is specified to test level. PR 2 is specified to contract level and gets its own plan slices. Discovery: [`SQL_SESSION_RELATION_BOUNDARY.discovery.md`](./SQL_SESSION_RELATION_BOUNDARY.discovery.md).

## Key decisions (flag for review)

1. **Two layers.** PR 1's AST gate closes every reproduced path now. PR 2's role makes Postgres the boundary, so a parser gap can never read a relation again. The gate also blocks every role or GUC mutation (`SET`, `RESET`, `set_config`), without which a `SET LOCAL ROLE`d session could switch back (discovery D1).
2. **`libpg-query@17.7.4` replaces `node-sql-parser` entirely.** It is Postgres 17's own parser as WASM (`main: ./wasm/index.cjs`, sole dependency `@pgsql/types`, 1.3 MB, `npm audit` clean, no OS packages for the #573 Trivy gate). There is no native build, so it is safe on the Alpine image. Its API is `loadModule()` once, then `parseSync(sql)` (verified). It matches the server version (PG 17 everywhere).
3. **Fail closed.** The gate rejects SQL that doesn't parse (Postgres would reject it anyway), any statement other than one `SELECT`, any relation outside the allowlist, any function outside the allowlist, and any schema-qualified relation or function. PR 2 adds: SQL tools refuse to run when the reader role is unusable, and they never fall back to the owner.
4. **Relations are checked against the session's own build.** `SessionViewBuild.viewMap` (today built but unused, `portal-sql.service.ts:111-120`) plus the `_meta_*` names emitted in that build plus CTE names in scope. Syntactic validation still runs before view resolution (it is cheap and needs no DB). The relation check runs after `resolveViewsForSession`.
5. **Functions come from an explicit allowlist** (`PORTAL_SQL_ALLOWED_FUNCTIONS`): unqualified, or qualified only as `pg_catalog.<allowed>`. It must include every function the server-generated wrapper and pushdown SQL uses (pinned by a test), and the PostGIS `st_*` family (`visualize_map` / tiles). It excludes `set_config`, `current_setting`, `pg_*`, `lo_*`, `dblink*`, `query_to_*`, `nextval`/`setval`, `txid_*` and `postgis_*`.
6. **`DISCARD TEMP` opens every session transaction** (`runSqlQuery`, `explainSqlQuery`, tiles, dissolve), so a temp view left by another user on a pooled connection can never be referenced. Tiles also switch to always-rollback, which removes the leftover at its source.
7. **Persisted pipelines are re-validated on every run.** Tile and dissolve SQL gets the same gate; a failure yields an empty tile / skipped precompute with a logged `PORTAL_SQL_FORBIDDEN`, never an unvalidated run.
8. **`transform_entity_records` fragments are scalar expressions.** `expression.value` and `sourceFilter.whereSqlFragment` are parsed as the target list / WHERE of `SELECT <expr> FROM __source` and may reference **no relation and no subquery**. The same function allowlist applies. The source entity lookup is also org-checked.
9. **Hotfix scope.** PR 1 is `Refs #660`; PR 2 is `Closes #660`. PR 1 ships on its own review chain.

## Scope

### In scope
- **PR 1:** the validator rewrite; the `node-sql-parser` removal (validator + `portal-sql-limit.util.ts`); the relation check wired into every session builder; `DISCARD TEMP`; the tile rollback; pipeline re-validation; transform fragment rules plus the org check; tests; `DEPLOYMENT_SECURITY_REVIEW.md`.
- **PR 2:** the reader-role migration; `PORTAL_SQL_READER_ROLE`; the per-session `GRANT` + `SET LOCAL ROLE`; the dissolve write split; the boot self-check plus `PORTAL_SQL_UNAVAILABLE`; `MIGRATE_DATABASE_URL`; the Helm `migrationUser`; the Helm README.

### Out of scope
- A least-privilege runtime role for the whole app (#397).
- Read-audit of agent SQL.
- Raw-table access for admins, which is not added.
- The incident scan of existing pins (discovery OQ5), which is an operational runbook step, not code.

## Surface — PR 1 (hotfix)

### `apps/api/src/services/portal-sql-parse.util.ts` (new)

```ts
import { loadModule, parseSync } from "libpg-query";
await loadModule(); // top-level, once per process (ESM TLA — api + workers)

export interface ParsedPortalSql {
  /** The single top-level statement's AST node (`SelectStmt`). */
  select: SelectStmtNode;
  /** Every relation referenced anywhere (FROM, JOIN, sublinks, CTE bodies, LATERAL), unqualified relname, excluding in-scope CTE names. */
  relations: ReadonlySet<string>;
  /** Every function called anywhere, lower-cased, as `name` or `pg_catalog.name`. */
  functions: ReadonlySet<string>;
  /** Top-level SELECT has no LIMIT and no aggregate in its target list and no GROUP BY. */
  needsImplicitLimit: boolean;
}
export function parsePortalSql(sql: string): ParsedPortalSql; // throws ApiError(400, PORTAL_SQL_FORBIDDEN, …)
export function parsePortalSqlExpression(
  fragment: string,
  kind: "target" | "where"
): { functions: ReadonlySet<string> }; // wraps as `SELECT <f> FROM __source` / `SELECT 1 FROM __source WHERE <f>`; rejects any relation other than the synthetic `__source`, and any SubLink
```

The AST walk visits every node generically: an object key `RangeVar`, `FuncCall`, `SubLink` or `CommonTableExpr` anywhere in the tree, so a new syntax position can't hide one. **Rejections** are all `ApiError(400, PORTAL_SQL_FORBIDDEN, <message>)`:

| Condition | Message |
|---|---|
| `SqlError` from `parseSync` | `syntax error: <libpg-query message>` |
| `stmts.length !== 1` | `exactly one statement is allowed` |
| Top-level node is not `SelectStmt` | `statement not allowed: <NodeType>` (covers `VariableSetStmt`, `ExplainStmt`, DML, DDL, `TransactionStmt`, `DoStmt`, `CopyStmt`) |
| `SelectStmt.intoClause` / `lockingClause` present | `SELECT INTO / FOR UPDATE not allowed` |
| `RangeVar.schemaname` set | `schema-qualified relation not allowed: <schema>.<name>` |
| `FuncCall.funcname` length > 2, or schema ≠ `pg_catalog` | `schema-qualified function not allowed: <…>` |

`RangeFunction` (set-returning functions in FROM) is function-checked. `RangeSubselect` and `SubLink` recurse.

### `apps/api/src/services/portal-sql-validation.util.ts` (rewritten)

```ts
export interface PortalSqlValidationResult {
  cleaned: string;              // unchanged meaning: comment-free SQL sent to Postgres
  needsImplicitLimit: boolean;  // now from the AST (ParsedPortalSql.needsImplicitLimit)
  relations: ReadonlySet<string>; // NEW — for the post-resolution relation check
}
export function validatePortalSql(sql: string): PortalSqlValidationResult;
export function assertRelationsAllowed(
  relations: ReadonlySet<string>,
  build: SessionViewBuild
): void; // throws PORTAL_SQL_FORBIDDEN `relation not allowed: <name>` for the first relation not in build.allowedRelations
export const PORTAL_SQL_ALLOWED_FUNCTIONS: ReadonlySet<string>;
```

- `validatePortalSql` keeps `stripComments` and the regex pre-filter, then calls `parsePortalSql`. It rejects any function not in `PORTAL_SQL_ALLOWED_FUNCTIONS`, unless the function matches `/^st_[a-z0-9_]+$/` (PostGIS) and is not `postgis_*`. Message: `function not allowed: <name>`.
- `maskStringLiterals` no longer masks double-quoted identifiers. This is moot for enforcement (the AST decides), but it keeps the pre-filter honest.
- **`PORTAL_SQL_ALLOWED_FUNCTIONS`:**
  - aggregates (`count`, `sum`, `avg`, `min`, `max`, `stddev`, `stddev_samp`, `stddev_pop`, `variance`, `var_samp`, `var_pop`, `mode`, `percentile_cont`, `percentile_disc`, `corr`, `covar_samp`, `covar_pop`, `regr_*`, `array_agg`, `string_agg`, `json_agg`, `jsonb_agg`, `json_object_agg`, `jsonb_object_agg`, `bool_and`, `bool_or`, `every`);
  - math (`abs`, `round`, `ceil`, `ceiling`, `floor`, `trunc`, `power`, `sqrt`, `cbrt`, `exp`, `ln`, `log`, `log10`, `mod`, `sign`, `greatest`, `least`, `width_bucket`, `random`, `pi`, `degrees`, `radians`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`);
  - text (`lower`, `upper`, `initcap`, `length`, `char_length`, `substring`, `substr`, `left`, `right`, `trim`, `btrim`, `ltrim`, `rtrim`, `lpad`, `rpad`, `replace`, `translate`, `concat`, `concat_ws`, `split_part`, `position`, `strpos`, `starts_with`, `regexp_replace`, `regexp_match`, `regexp_matches`, `regexp_split_to_array`, `format`, `to_char`, `md5`, `reverse`, `repeat`);
  - date and time (`now`, `current_date`, `date_trunc`, `date_part`, `extract`, `age`, `to_timestamp`, `to_date`, `make_date`, `make_timestamp`, `make_interval`, `justify_interval`);
  - window (`row_number`, `rank`, `dense_rank`, `percent_rank`, `cume_dist`, `ntile`, `lag`, `lead`, `first_value`, `last_value`, `nth_value`);
  - JSON (`json_build_object`, `jsonb_build_object`, `json_build_array`, `jsonb_build_array`, `to_json`, `to_jsonb`, `row_to_json`, `json_extract_path_text`, `jsonb_extract_path_text`, `jsonb_array_length`, `json_array_length`, `jsonb_typeof`, `json_typeof`, `jsonb_array_elements`, `jsonb_array_elements_text`, `json_array_elements`, `jsonb_each`, `jsonb_object_keys`);
  - arrays and sets (`array_length`, `cardinality`, `unnest`, `array_to_string`, `string_to_array`, `generate_series`);
  - misc (`coalesce`/`nullif` are not `FuncCall`s; `num_nulls`, `num_nonnulls`, `gen_random_uuid`).

  This list is the starting set. Adding a function is a reviewed, one-line change with a test.

### `apps/api/src/services/portal-sql-limit.util.ts`

`applyImplicitLimit(sql, rowCap): ImplicitLimitResult` keeps its signature. It decides from `parsePortalSql(sql).needsImplicitLimit`. A parse failure still means "wrap", but the validator has already rejected unparseable SQL, so that path is defensive only. `node-sql-parser` is removed from `apps/api/package.json`.

### `SessionViewBuild` + builders — `apps/api/src/services/portal-sql.service.ts`

```ts
export interface SessionViewBuild {
  views: ReadonlyArray<string>;
  viewMap: ReadonlyMap<string, string>;
  /** NEW — every relation name user SQL may reference: viewMap values ∪ the `_meta_*` views this build emitted. */
  allowedRelations: ReadonlySet<string>;
}
```

- `buildViewsForSession` populates `allowedRelations`. `resolveScopeHash` (`:137-142`) still hashes `views` only, so dissolve cache keys don't churn.
- **`runSqlQuery` / `explainSqlQuery`:** `validatePortalSql` stays first. `assertRelationsAllowed(result.relations, build)` runs right after `resolveViewsForSession`, before the transaction. The transaction's first statement becomes `DISCARD TEMP`, ahead of `SET LOCAL statement_timeout`.
- **Tiles** (`portal-map-tile.service.ts:876-905`): re-validate the pipeline SQL with `validatePortalSql` + `assertRelationsAllowed`; add `DISCARD TEMP` first; the transaction always rolls back, by throwing a result sentinel as `runSqlQuery` does. A validation failure returns an empty tile and logs `{ portalResultId, code: PORTAL_SQL_FORBIDDEN }`.
- **Dissolve** (`dissolve-precompute.processor.ts:187-218,256-275`): re-validate plus `DISCARD TEMP`. A validation failure marks the precompute failed (terminal, with the error recorded), with no write. It keeps committing its INSERT.
- **Handles** (`portal-sql-handle.service.ts`) already re-validate via `runSqlQuery`. No change beyond the inherited gate.

### `transform_entity_records` — `apps/api/src/tools/transform-entity-records.tool.ts`, `apps/api/src/services/bulk-transform.service.ts`

- In the pre-flight, before the EXPLAIN (`tool.ts:637-653`), call `parsePortalSqlExpression(expression.value, "target")` and, when present, `parsePortalSqlExpression(sourceFilter.whereSqlFragment, "where")`, then the function allowlist. A rejection returns a typed tool error: `TOOL_INPUT_INVALID`-style `{ error: { code: "PORTAL_SQL_FORBIDDEN", message } }`, per the existing tool error shape.
- `BulkTransformService.explainExpression` / `runBatch` / `fetchSourceBatch` re-assert the same parse before splicing (defence in depth; the job processor can be reached without the tool).
- The source lookup (`tool.ts:304`) is org-scoped: a `source.organizationId !== organizationId` result is treated as not found.

## Surface — PR 2 (role), at contract level

- **Migration** `npm run db:generate -- --name portal-sql-reader-role` (a hand-written SQL migration):
  - a `DO` block creates `NOLOGIN` role `current_setting('portalai.sql_reader_role', true)`, defaulting to `portalai_sql_reader`, **only when `current_user` has `rolcreaterole` or is superuser**; otherwise `RAISE NOTICE`;
  - `GRANT <role> TO CURRENT_USER`;
  - `REVOKE ALL ON SCHEMA public FROM <role>`;
  - no table grants;
  - it is idempotent, is not destructive DDL, and is marked `-- destructive-ok:` only if `lint:migrations` flags REVOKE.
- **`PORTAL_SQL_READER_ROLE`** env var (default `portalai_sql_reader`), read in `apps/api/src/environment.ts`.
- **Session:** after the view DDL, and before `transaction_read_only`, run `GRANT SELECT ON <each temp view + _meta_* view> TO <role>`, then `SET LOCAL ROLE <role>`, then `SET LOCAL transaction_read_only = on`, then the user SQL. The GRANT statements are kept out of `build.views` (scope-hash stability).
- **Dissolve:** the pipeline SELECT runs under the role `INTO` a session temp table. Then server-issued `RESET ROLE`, then `INSERT … SELECT` from that temp table as the owner.
- **Boot self-check** `PortalSqlService.assertReaderRoleUsable()`: in a rolled-back transaction, `SET LOCAL ROLE <role>` and confirm that `SELECT 1 FROM entity_records LIMIT 1` fails with 42501. On failure, the SQL tools register a typed refusal, **new `ApiCode.PORTAL_SQL_UNAVAILABLE`** (503): "the SQL workspace is unavailable: the restricted reader role is not provisioned". They never run unrestricted. Also checked lazily on the first session per process.
- **`MIGRATE_DATABASE_URL`:** `apps/api/src/scripts/db-migrate.ts` and `db:upgrade` prefer it, falling back to `DATABASE_URL`. Helm adds `postgresql.migrationUser` / `postgresql.external.migrationUser` (+ password, or an existing-secret ref). `templates/migrate-job.yaml` uses it when set. `README.md` documents it, with the manual `CREATE ROLE … NOLOGIN; GRANT … TO <app user>` fallback.

## Migration
- **PR 1:** none.
- **PR 2:** the one reader-role migration above. No backfill. Its journal and snapshot are committed with the `.sql` (per project memory).

## Seed
None.

## TDD test plan

The api runs `npm run test:unit -- --testPathPattern <file>` and `npm run test:integration -- --testPathPattern <file>` from `apps/api`.

### PR 1 — L1: parser + validator (unit) `apps/api/src/__tests__/services/portal-sql-validation.util.test.ts` (+ new `portal-sql-parse.util.test.ts`)
1. `"pg_catalog"."pg_roles"` → `schema-qualified relation not allowed` (the reproduced quoted bypass).
2. `set_config('statement_timeout','0',true)` → `function not allowed: set_config` (reproduced).
3. `SET LOCAL ROLE x`, `RESET ROLE`, `EXPLAIN SELECT 1`, `BEGIN`, `COPY`, `DO`, `SELECT … INTO t`, `SELECT … FOR UPDATE` → rejected with the table's messages.
4. Relations: `FROM er__x`, `JOIN entity_records`, a subquery in WHERE, a CTE body, LATERAL and `TABLE entity_records` are all collected. A CTE name isn't reported as a relation.
5. `current_setting`, `pg_sleep`, `nextval`, `lo_import`, `dblink`, `query_to_xml`, `postgis_full_version` → rejected. `st_area(geom)` is allowed.
6. `needsImplicitLimit` parity: the existing limit/aggregate cases stay green on the AST implementation.
7. A syntax error → `syntax error: …`, 400.
8. `parsePortalSqlExpression`: `c_a * 2` passes; `(SELECT max(c) FROM er__x)` → rejected; `c_a IN (SELECT …)` → rejected; `set_config(…)` → rejected.
9. Allowlist coverage: every function in server-generated wrapper/pushdown SQL (the analytics pushdown builders' output, handle aggregate/keyset wraps, and the tile SQL builder) passes `validatePortalSql`.

### PR 1 — L2: session boundary (integration) `apps/api/src/__tests__/__integration__/services/portal-sql.service.integration.test.ts`
10. Member `runSqlQuery` `SELECT * FROM "er__<other org entity>"` → `PORTAL_SQL_FORBIDDEN relation not allowed` (reproduced).
11. Member `SELECT count(*) FROM entity_records` → forbidden (reproduced).
12. The granted view key and `_meta_columns` still work (no regression).
13. **Leftover temp view:** commit a transaction that creates temp view `leak_v` on a pooled connection (as tiles did), then a member session on the same client referencing `leak_v` → forbidden (relation check), and after `DISCARD TEMP` the view no longer exists.
14. `explainSqlQuery` applies the same relation check.

### PR 1 — L3: pipelines + transform (integration)
15. `portal-map.router.integration.test.ts`: a pin whose pipeline references `er__<id>` → the tile returns empty (200/204) and nothing leaks. A valid pin still renders.
16. `dissolve-precompute.processor.integration.test.ts`: a pipeline with a raw relation → precompute failed, no `map_dissolve_geometries` rows.
17. `transform-entity-records` integration: an `expression` with `(SELECT … FROM er__<other org>)` → typed forbidden error, no job enqueued, no rows written. A cross-org `sourceConnectorEntityId` → not found.
18. Full regression: the existing portal-sql, handle, curated-view, map, dissolve, analytics-pushdown and resolve-identity suites stay green.

### PR 2 — L4: role (integration)
19. The migration is idempotent (run twice). The role exists, holds no table grants, and is a member of `CURRENT_USER`.
20. Under the role, a direct `SELECT FROM entity_records` fails 42501 **even when the validator is bypassed** (the test calls the transaction helper directly). Granted temp views still read.
21. The self-check passes; with the role dropped, the SQL tools return `PORTAL_SQL_UNAVAILABLE` and do not execute.
22. Dissolve under the role still writes via the post-`RESET ROLE` insert.
23. `db-migrate` prefers `MIGRATE_DATABASE_URL` (unit, env-driven).

**Totals:** PR 1 ≈ 9 unit + 9 integration groups (≈ 45 cases); PR 2 ≈ 5 groups (≈ 12 cases).

## Acceptance criteria

- [ ] As a member, `sql_query` against any `er__*`, `entity_records`, catalog or other non-view relation, quoted or not, is rejected with `relation not allowed` / `schema-qualified relation not allowed`, before execution.
- [ ] `set_config`, `current_setting`, role statements and every non-allowlisted function are rejected.
- [ ] A temp view created by another session on the same pooled connection cannot be referenced.
- [ ] Pinned tile and dissolve pipelines with raw relations produce no data.
- [ ] `transform_entity_records` fragments cannot reference any relation or subquery, and cannot target another org's entity.
- [ ] Every existing legitimate path (granted views, `_meta_*`, pushdown analytics, map tiles, handles) behaves as before.
- [ ] **PR 2:** with the reader role provisioned, a relation outside the session views is unreadable at the database level; without it, SQL tools refuse (`PORTAL_SQL_UNAVAILABLE`) rather than run as the owner. The Helm migration user provisions the role on installs whose app user lacks CREATEROLE.

## Risks & rollback

- **Fail mode: closed.** The cost is agent queries that used a now-disallowed function or form getting rejected. Mitigations:
  - the allowlist coverage test (case 9);
  - the full-suite regression (case 18);
  - the error names the function, and an addition is a one-line change.
- **Performance.** One WASM parse per query (sub-millisecond) and a `DISCARD TEMP` per session (cheap). PR 2 adds a few GRANTs per session.
- **`DISCARD TEMP` inside a transaction** is allowed (unlike `DISCARD ALL`). This is asserted by case 13.
- **Rollback.** Revert PR 1 to restore the old regex gate, which re-opens #660. There's no data or schema change in PR 1. PR 2's migration is additive; reverting it leaves an unused role behind.

## Files touched

- **PR 1, new:** `apps/api/src/services/portal-sql-parse.util.ts`, `apps/api/src/__tests__/services/portal-sql-parse.util.test.ts`.
- **PR 1, edit:**
  - `apps/api/package.json` (+ `libpg-query@17.7.4`, − `node-sql-parser`)
  - `package-lock.json`
  - `portal-sql-validation.util.ts`
  - `portal-sql-limit.util.ts`
  - `portal-sql.service.ts`
  - `portal-map-tile.service.ts`
  - `queues/processors/dissolve-precompute.processor.ts`
  - `tools/transform-entity-records.tool.ts`
  - `services/bulk-transform.service.ts`
  - the tests listed above
  - `docs/DEPLOYMENT_SECURITY_REVIEW.md` (the data-isolation statement)
- **PR 2, new:** `apps/api/drizzle/<n>_portal-sql-reader-role.sql` + meta. **Edit:** `environment.ts`, `portal-sql.service.ts`, `dissolve-precompute.processor.ts`, `scripts/db-migrate.ts`, `constants/api-codes.constants.ts` (`PORTAL_SQL_UNAVAILABLE`), `deploy/helm/portalai/{values.yaml,templates/migrate-job.yaml,templates/_helpers.tpl,README.md}`, `docs/LOCAL_DEVELOPMENT.md` if env docs change.

## Next step

`docs/SQL_SESSION_RELATION_BOUNDARY.plan.md` will sequence **PR 1** as about four test-first slices:
1. The parser util + validator rewrite + the `node-sql-parser` removal (L1). The reproduced bypasses become failing tests first.
2. The relation check in `runSqlQuery` / `explainSqlQuery` + `DISCARD TEMP` (L2).
3. Tiles and dissolve re-validation + the tile rollback (L3, 15–16).
4. Transform fragments + the org check (17), with the full regression at the end.

**PR 2** is a separate branch off `main` after PR 1 merges, in about three slices: the migration + env + self-check; the session role + GRANTs + the dissolve split; the migration connection + Helm.
