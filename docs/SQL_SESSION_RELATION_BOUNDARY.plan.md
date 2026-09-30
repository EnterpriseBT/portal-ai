# SQL session relation boundary — Plan

**A TDD-sequenced hotfix (PR 1) that makes every agent SQL path reject any relation, function or statement outside the caller's session, followed by the database-role guarantee (PR 2) on its own branch.**

Spec: `docs/SQL_SESSION_RELATION_BOUNDARY.spec.md`. Discovery: `docs/SQL_SESSION_RELATION_BOUNDARY.discovery.md`. Issue: #660 (epic #578, critical). This builds on shipped #599 (curated views / `resolveViewsForSession`), #643 (tile/dissolve per-user views) and #658 (the `queryViewRowsByColumn` / `renderViewFilterWhere` shape).

**PR 1 (hotfix, `Refs #660`) has five slices** on `fix/660-sql-session-relation-boundary`. Each slice sits behind a green test suite and leaves the repo compilable. **PR 2 (`Closes #660`) has three slices** on a fresh branch off `main` after PR 1 merges.

Run tests from `apps/api` (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit -- --testPathPattern <file>
cd apps/api && npm run test:integration -- --testPathPattern <file>
```

Each slice: (1) write failing tests; (2) make the smallest change to green them; (3) do a focused run; (4) run `npm run lint && npm run type-check` at the boundary; (5) move to the next slice.

Sequencing rationale: swap the parser before changing any rule, so parity is proven on its own. Then tighten the pure rules, then enforce relations at the session, then the persisted-pipeline paths, then the out-of-session transform path.

- **Slice 1:** `libpg-query` replaces `node-sql-parser` with **no rule change**, so any later breakage is a rule, not the parser.
- **Slice 2:** the statement, schema and function rules. Pure unit tests; they close the quoted-catalog and `set_config` bypasses.
- **Slice 3:** the relation check plus `DISCARD TEMP` in `runSqlQuery` / `explainSqlQuery`. This closes the reproduced cross-tenant reads and the leftover-temp-view leak for every live SQL tool.
- **Slice 4:** tiles and dissolve re-validation plus the tile rollback, for persisted pipelines.
- **Slice 5:** `transform_entity_records` fragments plus its org check, the full regression, and the docs.

---

## Slice 1 — `libpg-query` parser util; retire `node-sql-parser` (behaviour-preserving)

This adds the parse util and moves `needsImplicitLimit` / `applyImplicitLimit` onto it. The validator rules are unchanged.

**Files**
- New: `apps/api/src/services/portal-sql-parse.util.ts`, with a top-level `await loadModule()`, `parsePortalSql` (returning `select`, `relations`, `functions`, `needsImplicitLimit`), and the generic AST walk. At this slice it throws only on a syntax error or `stmts.length !== 1`.
- New: `apps/api/src/__tests__/services/portal-sql-parse.util.test.ts`.
- Edit: `apps/api/src/services/portal-sql-validation.util.ts`. `computeNeedsImplicitLimit` delegates to `parsePortalSql`, and the result gains `relations`.
- Edit: `apps/api/src/services/portal-sql-limit.util.ts`. `applyImplicitLimit` decides from the AST; its signature is unchanged.
- Edit: `apps/api/package.json` / `package-lock.json`, adding `libpg-query@17.7.4` (via `npm install --workspace @portalai/api libpg-query@17.7.4`) and removing `node-sql-parser`.

**Steps**
1. **Tests (spec cases 4, 6, 7).**
   - Relation collection across FROM, JOIN, subquery, CTE body, LATERAL and `TABLE`, with CTE names excluded.
   - `needsImplicitLimit` parity with every existing limit/aggregate case.
   - A syntax error surfaces as `PORTAL_SQL_FORBIDDEN syntax error: …`.

   Run; fail (the util is missing).
2. **Implement** the util and swap both call sites. Keep `validatePortalSql`'s regex rules exactly as they are. Green, and the existing `portal-sql-validation.util.test.ts` and `portal-sql-limit` tests stay green unchanged.
3. Lint + type-check. Then a **Docker build of the API image** (`docker build -f apps/api/Dockerfile .`) to prove the WASM package loads on Alpine: boot the container, `GET /api/health`.

**Done when:** cases 4, 6 and 7 pass; `node-sql-parser` appears nowhere in `apps/api` (`grep -r node-sql-parser apps/api/src` is empty); the image boots.

**Risk:** a syntax error is now raised at validation instead of by Postgres. The message changes, but the outcome doesn't. Check that the agent-facing translation (`translateExecutionError`) isn't bypassed for anything the tests pin.

---

## Slice 2 — statement, schema-qualification and function allowlist rules

**Files**
- Edit: `portal-sql-parse.util.ts`, rejecting a non-`SelectStmt` top level, `intoClause` / `lockingClause`, a schema-qualified `RangeVar`, and a schema-qualified `FuncCall` (except `pg_catalog.<allowed>`).
- Edit: `portal-sql-validation.util.ts`, adding the `PORTAL_SQL_ALLOWED_FUNCTIONS` constant (the spec's list), the `st_*` / `postgis_*` rule, the function check, and no longer masking double-quoted identifiers in `maskStringLiterals`.
- Edit: `portal-sql-validation.util.test.ts`, `portal-sql-parse.util.test.ts`.

**Steps**
1. **Tests (spec cases 1, 2, 3, 5, 9).**
   - `"pg_catalog"."pg_roles"` → `schema-qualified relation not allowed`.
   - `set_config(...)` → `function not allowed: set_config`.
   - The statement list: `SET LOCAL ROLE`, `RESET ROLE`, `EXPLAIN`, `BEGIN`, `COPY`, `DO`, `SELECT INTO`, `FOR UPDATE`.
   - The forbidden-function list, with `st_area` allowed.
   - **Allowlist coverage (case 9):** feed the SQL emitted by the analytics pushdown builders (`hypothesis_test`, `regression`, `var_cvar`), the handle aggregate/keyset wrappers and the tile SQL builder through `validatePortalSql`; all pass. Import the real builders, not hand-copied strings.

   Run; fail.
2. **Implement** the rules and the constant. Green.
3. Run the **existing** SQL-adjacent unit suites: portal-sql-handle, analytics pushdown, portal-sql-view-memo, sql-query tool. Every function they emit must be allowlisted. Add any missing legitimate one to the constant, with a note.
4. Lint + type-check.

**Done when:** cases 1, 2, 3, 5 and 9 pass, and no existing unit suite regresses.

**Risk:** this is the slice most likely to break legitimate agent SQL (the allowlist). Case 9 plus step 3 are the guard, and a rejected function names itself in the error.

---

## Slice 3 — relation allowlist in the session + `DISCARD TEMP`

**Files**
- Edit: `apps/api/src/services/portal-sql.service.ts`.
  - `SessionViewBuild.allowedRelations`, populated by `buildViewsForSession` (view keys ∪ the emitted `_meta_*` names). `resolveScopeHash` still hashes `views` only.
  - `assertRelationsAllowed` is called in `runSqlQuery` and `explainSqlQuery` right after `resolveViewsForSession`.
  - `DISCARD TEMP` becomes the first statement of both transactions.
- Edit: `portal-sql-validation.util.ts`, exporting `assertRelationsAllowed`.
- Edit: `apps/api/src/__tests__/__integration__/services/portal-sql.service.integration.test.ts`.

**Steps**
1. **Tests (spec cases 10–14).** Seed a second org with its own entity and wide table (the #658 regression-suite pattern).
   - A member's `SELECT * FROM "er__<other org entity>"` → `unknown entity`.
   - `SELECT count(*) FROM entity_records` → forbidden.
   - The granted view and `_meta_columns` still work.
   - **Leftover temp view:** on one pooled client, commit a transaction that creates temp view `leak_v`, then a member session referencing `leak_v` → forbidden, and `leak_v` is gone after the session's `DISCARD TEMP`.
   - `explainSqlQuery` enforces the same check.

   Run; the cross-tenant cases fail (they return rows today).
2. **Implement.** Green.
3. Run the full portal-sql integration suites plus handle, curated-view and resolve-identity (the #658 suite). There must be no regression.
4. Lint + type-check.

**Done when:** cases 10–14 pass, and the reproduced cross-tenant reads return `PORTAL_SQL_FORBIDDEN` for `sql_query`, `display_entity_records`, `visualize_*` and handle re-runs (all route through `runSqlQuery`).

**Risk:** `DISCARD TEMP` must run inside the transaction on the same connection that then builds the views. It does, since it's the first `tx.execute`. The leftover-view test proves the ordering.

---

## Slice 4 — persisted pipelines: tiles + dissolve re-validation, tile rollback

**Files**
- Edit: `apps/api/src/services/portal-map-tile.service.ts:876-905`.
  - Re-validate the pipeline SQL (`validatePortalSql` + `assertRelationsAllowed`); on failure, return an empty tile and log `{ portalResultId, code }`.
  - `DISCARD TEMP` first.
  - The transaction always rolls back, via a result sentinel as in `runSqlQuery`.
  - Correct the comment at `:922-930`.
- Edit: `apps/api/src/queues/processors/dissolve-precompute.processor.ts:187-218,256-275`. Re-validate plus `DISCARD TEMP`; a failure marks the precompute failed (terminal, error recorded) with no write.
- Edit: `apps/api/src/__tests__/__integration__/routes/portal-map.router.integration.test.ts`, `…/queues/dissolve-precompute.processor.integration.test.ts`.

**Steps**
1. **Tests (spec cases 15, 16).**
   - A pin whose pipeline SQL references `er__<id>` → the tile is empty and there's no leak; a valid pin still renders.
   - A dissolve for a raw-relation pipeline → failed, 0 `map_dissolve_geometries` rows.
   - The tile transaction leaves no temp view on its connection (assert via `pg_class` in a follow-up query on the same client, inside a test helper).

   Run; fail.
2. **Implement.** Green.
3. Run the map suites (map-aggregation, map-dissolve-geometries, portal-map router/tile unit, the dissolve suites). There must be no regression.
4. Lint + type-check.

**Done when:** cases 15–16 pass, and tiles leave no temp views behind.

**Risk:** switching tiles to rollback must not break tile caching or ETag logic. Those read results in memory, not from committed state. Verify with the existing tile suites.

---

## Slice 5 — `transform_entity_records` fragments + org check; full regression; docs

**Files**
- Edit: `portal-sql-parse.util.ts`, adding `parsePortalSqlExpression(fragment, "target" | "where")`.
- Edit: `apps/api/src/tools/transform-entity-records.tool.ts`. The pre-flight parses `expression.value` / `sourceFilter.whereSqlFragment` before the EXPLAIN, with a typed forbidden error. The source lookup (`:304`) is org-scoped.
- Edit: `apps/api/src/services/bulk-transform.service.ts`, re-asserting the parse in `explainExpression`, `runBatch` and `fetchSourceBatch` (defence in depth).
- Edit: `portal-sql-parse.util.test.ts` (case 8); the transform integration test (case 17; the existing `transform-entity-records` / bulk-transform integration suite).
- Edit: `docs/DEPLOYMENT_SECURITY_REVIEW.md`, whose data-isolation / agent-SQL statement must describe the new gate (and note PR 2 pending).

**Steps**
1. **Tests (spec cases 8, 17).**
   - `c_a * 2` passes.
   - `(SELECT max(c) FROM er__x)`, `c_a IN (SELECT …)` and `set_config(…)` → rejected.
   - An integration transform with a cross-org subquery → typed error, no job, no rows.
   - A cross-org `sourceConnectorEntityId` → not found.

   Run; fail.
2. **Implement.** Green.
3. **Full regression (spec case 18):** run every integration suite that touches SQL (portal-sql, handles, curated views, map, dissolve, analytics pushdown, resolve-identity, transform/bulk), plus `npm run test:unit` for api.
4. Lint, type-check, format and the root `build`.

**Done when:** cases 8 and 17 pass, the full regression is green, and the security-review doc is updated.

**Risk:** real transform expressions in use today may call unlisted functions. The error names the function, and the allowlist is shared, so an addition covers both paths.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `libpg-query` parser util; `node-sql-parser` removed | cases 4, 6, 7; existing validator/limit tests unchanged; API image boots |
| 2 | statement / schema / function-allowlist rules | cases 1, 2, 3, 5, 9; no existing SQL unit suite regresses |
| 3 | session relation allowlist + `DISCARD TEMP` | cases 10–14; the cross-tenant repro returns forbidden |
| 4 | tiles + dissolve re-validation, tile rollback | cases 15–16; no leftover temp views |
| 5 | transform fragments + org check; full regression; docs | cases 8, 17, 18 |

## PR 2 (reader role) — outline, on a new branch after PR 1 merges

1. **Migration + env + self-check:** the reader-role migration (idempotent, CREATEROLE-guarded), `PORTAL_SQL_READER_ROLE`, `assertReaderRoleUsable`, and `PORTAL_SQL_UNAVAILABLE`. Spec cases 19 and 21.
2. **Session role + GRANTs + dissolve split:** per-session `GRANT SELECT` + `SET LOCAL ROLE`, and dissolve's `RESET ROLE` then `INSERT` from a temp table. Cases 20 and 22.
3. **Migration connection + Helm:** `MIGRATE_DATABASE_URL` in `db-migrate.ts` / `db:upgrade`, the Helm `migrationUser` values plus `migrate-job.yaml`, and the README. Case 23.

It gets its own spec amendment if its surface shifts, and its own full review chain.

## Cross-slice notes

- **The hotfix review chain.** It's still a full Bug touching data access, so code-review, security, smoke and adversarial are all required. Smoke and adversarial reuse the #658 walk mechanics: an API-level member probe of the reproduced bypasses, plus one agent session.
- **The allowlist is the main behaviour risk** (slices 2 and 5). Any legitimate function discovered missing is added with a test in the slice that finds it.
- **Tell the operators.** PR 1's description should say that agent SQL is now allowlist-gated, and that a rejected function is reported by name. Record the post-merge app-dev check (the #658 raw-table probe returns forbidden) in the PR.
- **Doc sync:** `DEPLOYMENT_SECURITY_REVIEW.md` (slice 5). PR 2 updates the Helm README and `LOCAL_DEVELOPMENT.md` if env vars change. No tool description changes (same tools, same inputs). The `system.prompt.ts` guidance needs no change.
- **Incident follow-up (not code):** after PR 1 is on app-dev and prod, run the read-only pin scan (discovery OQ5) to identify any stored pipeline that referenced a raw relation.

## Next step

Once discovery, spec and plan are confirmed, implementation begins on `fix/660-sql-session-relation-boundary` with slice 1 (the parser swap, tests first), one commit per slice. The draft PR (`Refs #660`) opens with the first implementation commit.
