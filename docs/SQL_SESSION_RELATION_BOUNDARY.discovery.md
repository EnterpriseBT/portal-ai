# SQL session relation boundary — Discovery

**Issue:** [EnterpriseBT/portal-ai#660](https://github.com/EnterpriseBT/portal-ai/issues/660)

**Why this exists.** Every agent SQL surface (`sql_query`, `display_entity_records`, `visualize_*`, the handle-consuming analytics tools, map tiles, dissolve) assumes the per-user temp views are the only relations a query can reach. They are not. `runSqlQuery` runs LLM-authored SQL as the API's database role: the RDS master user in prod, the `postgres` superuser locally. `validatePortalSql` never restricts relations.

The #658 adversarial walk proved a member can read **any org's** physical tables. Another org's `er__<uuid>` returned 30 rows, and `entity_records` returned 1,003,715 rows across all orgs. The #660 survey then found and confirmed more gaps, all live on `main` @ `085d9711`:
- **Quoted identifiers bypass every regex**: `"pg_catalog"."pg_roles"` returns 16 rows.
- **`set_config` is not blocked**: `set_config('statement_timeout','0',true)` returns `0`.
- **The session runs as a superuser locally** (`current_user = postgres`).
- **`transform_entity_records` splices agent SQL fragments raw** outside the session.
- **Committed tile and dissolve transactions leave other users' temp views on pooled connections.**

This is the fix that makes the database, not the prompt and not a regex, the boundary: an agent SQL session can read exactly the caller's granted views and nothing else.

## The current shape

### The session (`apps/api/src/services/portal-sql.service.ts`)

| Step | Location | Note |
|---|---|---|
| Validate | `:846` `validatePortalSql` | Regex only (below) |
| Implicit LIMIT | `:849` `applyImplicitLimit` (`portal-sql-limit.util.ts`) | |
| Resolve views (pre-txn, #314) | `:868` `resolveViewsForSession`, memoized per request `:636-660` | Key `views:<station>:<user>:<org>`; no-op in workers |
| Txn: `SET LOCAL statement_timeout` → view DDL → `SET LOCAL transaction_read_only = on` → user SQL → optional exact count | `:876-912` | Always rolled back via a `PortalSqlTxResult` sentinel (`:185`, `:934-942`); `explainSqlQuery` `:969-1021` mirrors it |
| Temp views | `pushTempView` `:102-109` (DROP + `CREATE TEMP VIEW`) | Each granted view selects **directly from `"er__<entityId>"`** with an org literal, soft-delete guard and filter (`:682-725`). `security_invoker` is off (definer semantics, PG default) |
| `_meta_*` views | `:744-825` | Read app tables (`curated_views`, `field_mappings`, `column_definitions`, `connector_entities`, `wide_table_columns`) |
| Unused allowlist | `SessionViewBuild.viewMap` `:111-120`, `:677`, `:827` | Built, **never consulted** |
| Error mapping | `translateExecutionError` `:1068-1096` | 42P01 → "unknown entity"; 25006 → "write attempt blocked" |

### Validation (`apps/api/src/services/portal-sql-validation.util.ts`)

- It strips comments (`:223-296`), rejects non-trailing `;` (`:298-345`) and runs regexes over `RESERVED_VERBS` (`:51-97`), `SYSTEM_CATALOG` (`:99-135`) and `SIDE_EFFECT_FUNCTIONS` `/\b(pg_|lo_|dblink|query_to_)/` (`:137`).
- **`maskStringLiterals` also blanks double-quoted identifiers** (`:185-216`, `ch === '"'`), so any quoted name escapes every rule.
- **`set_config(` is not a verb match** (`_` is a word character).
- `node-sql-parser` ^5.4.0 is imported but used only for `computeNeedsImplicitLimit` (`:347-375`). Its `tableList()` / `whiteListCheck()` APIs are unused.
- Tests: `apps/api/src/__tests__/services/portal-sql-validation.util.test.ts`, with no relation or quoted-identifier cases.

### Entry points that execute agent-authored SQL

| Surface | Path | Session? | Validated? |
|---|---|---|---|
| `sql_query` | `tools/sql-query.tool.ts:141`, `tools.service.ts:582-596` | yes | yes |
| `display_entity_records` | `tools/display-entity-records.tool.ts:66-79` → `PortalSqlHandleService.produce` | yes | yes (`entityKey` quoted, but any relation name accepted) |
| `visualize_d3` / `visualize_map` | `tools/visualize-d3.tool.ts:117-129`, `tools/visualize-map.tool.ts:239,265,314` | yes | yes |
| Handle re-runs, aggregate, stream keyset | `portal-sql-handle.service.ts:126-160,555-577,666-700` | yes (persisted `_userId`) | yes |
| Analytics pushdown (`hypothesis_test`, `regression`, `var_cvar`) | `analytics.service.ts:935,1770-1823,2823-2855` | yes | yes |
| Map tiles | `portal-map-tile.service.ts:876-905` | per-user views | **no** (persisted pipeline); read-only; **txn commits** |
| Dissolve precompute | `queues/processors/dissolve-precompute.processor.ts:187-218,256-275` | per-user views | **no**; **not read-only** (INSERTs); **commits** |
| **`transform_entity_records`** | `tools/transform-entity-records.tool.ts:189-199`, `services/bulk-transform.service.ts:84-97,~180-230` | **no**: default connection, raw `expression` / `whereSqlFragment` splice | **no** (only an EXPLAIN pre-flight) |

`transform_entity_records` is `mode: "bulk"` (admin-only), but an admin of org A can still embed `(SELECT … FROM "er__<org B id>")` and write the result into A's table. That is **cross-tenant for admins**.

### Roles and connections

- There is one pool (`apps/api/src/db/client.ts:18-40`, `max: 10`), with the password resolved per connection (#500).
- The app **and** migrations connect as the RDS master `portalai` (`infra/cloudformation/database.yml:19-21,88-89`), and as `postgres` locally and in CI (`docker-compose.yml`, `integration/setup.ts:22-23`).
- **No migration creates roles or GRANTs.** `drizzle/0096_add-audit-log-table.sql:23-30` defers a least-privilege runtime role to #397.
- Postgres is **17** everywhere (`database.yml:82`, `imresamu/postgis:17-3.5`).
- Helm uses a bundled Bitnami or external user (`deploy/helm/portalai/values.yaml:100-125`) that **may lack CREATEROLE**. The README requires only `CREATE EXTENSION postgis`.

## The design space

### Decision 1 — Where the boundary lives

- **A. A database role.** Each session does `SET LOCAL ROLE portal_sql_reader`, a NOLOGIN role with **no** table grants. The temp views, created by the API role before the switch, carry `GRANT SELECT … TO portal_sql_reader`, and definer semantics let them read `er__*`. A raw `er__`, `entity_records` or catalog-table reference then fails with 42501 from Postgres itself, whatever the SQL text looks like.
- **B. A parser allowlist.** Parse the SQL and reject any relation that isn't a session view key or `_meta_*`, plus a function allowlist.
- **C. Both:** A is the guarantee, and B gives early, precise errors and defence in depth.

| | A role | B allowlist | C both |
|---|---|---|---|
| Survives parser differentials / new syntax | yes | no: every missed grammar path is a bypass (today's quoted-identifier gap is exactly this) | yes |
| Blocks escalation back to the owner | only if `RESET ROLE` / `SET ROLE` / `set_config('role',…)` are also blocked | n/a | yes |
| Clear agent-facing error | 42501, mapped | yes | yes |
| Provisioning cost | a role across all environments (D5) | none | the role cost |

**Lean: C.** A regex or parser can only ever approximate Postgres's grammar, so the durable guarantee has to be the role. The role alone is not enough, though: a role switched with `SET LOCAL ROLE` can switch straight back, so the validator must block every role and GUC mutation. With that, the two layers close each other's gaps.

### Decision 2 — The parser for the allowlist and function checks

- **A.** `node-sql-parser` (already a dependency): `tableList()` + an allowlist. It's a different grammar from Postgres, so differentials remain.
- **B.** `libpg-query` / `pgsql-parser`: **Postgres's own parser** compiled to WASM. The AST is exactly what the server will execute (range vars, function calls, SET statements). It's a new dependency, which needs checking against the #573 image gate.

**Decided: B, replacing `node-sql-parser` entirely.** Its one current use, `computeNeedsImplicitLimit` (`portal-sql-validation.util.ts:347-375`), moves to the same `libpg-query` AST, and the dependency is removed from `apps/api/package.json`. Using the server's own grammar removes the differential that produced the quoted-identifier bypass. The AST walk yields every `RangeVar`, `FuncCall` and `VariableSetStmt`. The regex layer stays as a cheap pre-filter.

### Decision 3 — Temp views left on pooled connections

- **A.** `DISCARD TEMP` (or dropping all session-built view names) at the start of every session build.
- **B.** Make every path roll back. Tiles currently return normally, and dissolve commits.
- **C.** Per-connection temp schema resets on checkout, in the pool hook.

**Lean: A + B.** `DISCARD TEMP` at the head of every session transaction means a view left over from another user can never be referenced. Rolling back tiles removes the leftover at its source. Dissolve must commit its INSERT, so it relies on A. `ON COMMIT DROP` isn't available for views.

### Decision 4 — Persisted pipelines (tiles, dissolve) that skip validation

Stored pipeline SQL passed only the old, weak validator, so a pinned pipeline could already hold an `er__` reference.

- **A.** Re-validate on every run with the new validator; a failure yields an empty tile and a stale-pipeline error.
- **B.** Rely on the role.

**Lean: both.** Run the tile read under the role. For dissolve, run the pipeline `SELECT` under the role into a session temp table, then the server's own `RESET ROLE` and `INSERT … SELECT` from that temp table as the owner. The user SQL has finished by then, so the reset is server-controlled.

### Decision 5 — Provisioning the role across environments

Why a Helm user might not be able to create roles:
- **Bundled Postgres.** The chart composes `DATABASE_URL` from `postgresql.auth.username` (`deploy/helm/portalai/values.yaml:111-114`, `templates/_helpers.tpl:62-64`). The Bitnami subchart creates that user as an ordinary login role that owns the `portalai` database, and keeps superuser for the separate `postgres` account. So `portalai` has no CREATEROLE. The chart also swaps in the `imresamu/postgis` image, whose entrypoint conventions differ, so the effective privileges there are unverified (the chart already flags it as a smoke risk).
- **External managed Postgres.** The customer supplies `postgresql.external.user`. The provider admin accounts (the RDS master, Cloud SQL `cloudsqlsuperuser`, the Azure flexible-server admin) do have CREATEROLE. A security-conscious enterprise, our target customer, typically hands the app a **scoped application user** instead: it owns one database and has no role-management rights.
- **The migrate job uses the app's own `DATABASE_URL`** (`templates/migrate-job.yaml:36`), so whatever that user can't do, the migration can't either.

So it is a *may*, not a *can't*: many installs will work, but the ones we most need to protect are the least likely to.

- **A.** A migration creates the role, guarded with `IF NOT EXISTS` and a CREATEROLE check; if the connecting user can't create it, it emits a NOTICE. A boot self-check (can this connection `SET ROLE <reader>`?) makes SQL tools **fail closed** with a typed error when the role is missing. They must never run unrestricted.
- **B.** The DBA pre-creates the role (a documented prerequisite), with the same fail-closed self-check.
- **C.** No role.

- **D. A separate migration connection:** an optional privileged URL used **only** by the migrate job (`MIGRATE_DATABASE_URL`; Helm `postgresql.migrationUser` / `external.migrationUser`, falling back to the app URL). The customer hands the one-time migration a user with CREATEROLE, and the app keeps running as the scoped user.

**Decided: A + D, with B as the documented fallback.** RDS, local and CI can create it. Helm installs without CREATEROLE get a README prerequisite (`CREATE ROLE … NOLOGIN; GRANT … TO <app user>`). With D, a Helm install whose app user lacks CREATEROLE sets a migration user, and the role is created with no manual DBA step. Role names are cluster-wide, so the name is configurable (`PORTAL_SQL_READER_ROLE`, default `portalai_sql_reader`) for shared clusters. The migration also runs `GRANT <reader> TO CURRENT_USER`, which `SET ROLE` requires.

### Decision 6 — `transform_entity_records` and other raw fragments

- **A.** Treat `expression` and `whereSqlFragment` as **scalar expressions over the source row only**. Parse them, reject any relation reference or subquery, and apply the same function allowlist.
- **B.** Run the transform reads under the role too.

**Lean: A.** A projection or predicate never legitimately needs another relation, so "no relation at all" is a simpler and stronger rule than an allowlist. The write side stays on the owner connection, but it only receives values computed from the source row. Also fix its un-org-checked `findById` (`transform-entity-records.tool.ts:304`).

### Decision 7 — Sequencing, given the exposure

- **A.** One PR with everything.
- **B.** Two PRs: the validator hardening (AST relation allowlist, a function allowlist blocking `set_config` / `pg_*`, role/GUC statement blocks, `DISCARD TEMP`, the tile rollback, transform fragment rules) ships first as the fast stop. The role follows.

**Decided: B. PR 1 ships as a hotfix, with no interim feature flag.** It closes every reproduced path. The role (PR 2) is the durable guarantee, but it carries provisioning work (Helm), so it doesn't hold the hotfix hostage. Both PRs belong to #660; PR 1 references it and PR 2 closes it.

## Tradeoff comparison

|  | D1 C | D2 libpg-query | D3 DISCARD+rollback | D4 revalidate+role | D5 migration+self-check | D6 no-relation fragments | D7 two PRs |
|---|---|---|---|---|---|---|---|
| Closes a reproduced path | yes | yes (quoted ident) | yes (leftover views) | yes (pinned) | enables D1 | yes (transform) | faster stop |
| New dependency / infra | role | WASM parser | none | none | migration + README | none | none |
| Spread to spec | yes | yes | yes | yes | yes | yes | yes |

## Recommendation

1. **PR 1 (validator):**
   - replace the regex-only gate with a `libpg-query` AST walk;
   - every range var must be a session view key or `_meta_*` (from `SessionViewBuild.viewMap`), and anything else fails with `PORTAL_SQL_FORBIDDEN` naming the relation;
   - allow only listed functions (this blocks `set_config`, `pg_*`, `lo_*`, `dblink*`, `current_setting` writes) and reject `SET` / `RESET` / `SET ROLE` / transaction statements outright;
   - keep the regex layer as a pre-filter.
2. **PR 1:** `DISCARD TEMP` opens every session transaction (`runSqlQuery`, `explainSqlQuery`, tiles, dissolve), and the tile transaction rolls back.
3. **PR 1:** persisted tile and dissolve pipelines are re-validated on every run, failing closed.
4. **PR 1:** `transform_entity_records` `expression` / `whereSqlFragment` are parsed as expressions with **zero** relation references or subqueries, plus the function allowlist. The source entity lookup is org-checked.
5. **PR 2 (role):**
   - a migration creates the NOLOGIN `PORTAL_SQL_READER_ROLE` (default `portalai_sql_reader`) with `GRANT … TO CURRENT_USER`, guarded;
   - the session adds `GRANT SELECT` on its temp and `_meta_*` views to the role, then `SET LOCAL ROLE` before `transaction_read_only`;
   - dissolve's write happens after a server-side `RESET ROLE`;
   - a boot self-check fails SQL tools closed when the role is unusable;
   - an optional migration-only connection (`MIGRATE_DATABASE_URL`; Helm `postgresql.migrationUser` / `external.migrationUser`) runs migrations as a privileged user while the app stays scoped; `db-migrate.ts` and `migrate-job.yaml` prefer it, falling back to `DATABASE_URL`;
   - the Helm README documents the migration user, with the manual `CREATE ROLE` as the fallback.
6. Regression suites: every reproduced path (other-org `er__`, `entity_records`, quoted catalog, `set_config`, leftover temp view, transform subquery) must fail in both PRs' tests. The #658 repro fixture pattern is the template.
7. Update `docs/DEPLOYMENT_SECURITY_REVIEW.md` (data-isolation claims) and the Helm README in the same PRs, per the documentation-sync rule.

## Open questions

1. **Interim mitigation before PR 1?** **Decided: no flag. PR 1 ships as the hotfix** (D7).
2. **Does `libpg-query`'s WASM build pass the #573 Trivy gate and fit the runtime image?** **Lean:** check in the spec phase (the build, the image size, and whether Trivy is clean). `libpg-query` is decided (D2), so a blocking finding means pinning or patching it, not falling back.
3. **`GRANT` on a temp view inside the session transaction: is it allowed, and does it change `resolveScopeHash`?** **Lean:** allowed (the view owner can grant). Keep the GRANTs out of `build.views` so scope hashes (the dissolve cache) don't churn.
4. **Does the restricted role need `TEMP` on the database for dissolve's temp table?** PUBLIC holds it by default. **Lean:** yes, and assert it in the self-check.
5. **Audit existing pinned pipelines for raw relation references?** **Lean:** yes. A one-off `portalops` read-only scan listing pins whose SQL references a non-view relation, so affected customers can be identified. This is an incident-response item, not code.

## Enterprise-scale considerations

- **Concurrency & correctness.** Temp views are per connection. `DISCARD TEMP` at transaction start makes the build hermetic under pool reuse and multi-instance ECS. **Lean:** that, plus the tile rollback.
- **Accuracy & auditability.** Whether any tenant data was read across orgs before the fix is unknowable from app logs, since sessions aren't audited. **Lean:** the OQ5 scan, plus RDS query logs if enabled. Read-audit stays out of scope (#575 covers mutations).
- **Failure modes.** **Lean: fail closed everywhere.** An unparseable query, an unknown relation, a missing role, a failed self-check or a failed persisted-pipeline re-validation all deny. Never fall back to running as the owner.
- **Scale & unbounded growth.** One AST parse per query (sub-millisecond) and a few GRANT statements per session. `set_config` blocking also restores the statement-timeout guarantee against runaway queries. **Lean:** negligible cost.
- **Multi-tenancy.** This ticket *is* tenant isolation on the SQL surface. **Lean:** the database role is the tenant boundary; the org literal inside views stays as a second guard.
- **Contract stability.** The agent-facing contract is unchanged (same view names, same errors, with a new "relation not allowed" message). The role name is configurable for residency and shared clusters (#569). **Lean:** additive.
- **Data lifecycle.** N/A: no retention or window semantics.

## What this doesn't decide

- A separate least-privilege *runtime* role for the whole app (#397's broader scope). This ticket only restricts the agent SQL session.
- Read-audit logging of agent SQL (a compliance feature).
- Whether admins should get raw-table SQL access. Today they don't by design (views are the read path for everyone), and nothing here adds it.

## Next step

`docs/SQL_SESSION_RELATION_BOUNDARY.spec.md` pins both PRs' contracts: the AST rules, the allowlist source, the function allowlist, the `DISCARD TEMP` placement, the transform expression grammar, the migration, the self-check, and the error codes. `.plan.md` slices PR 1 into about four test-first commits (validator AST + relations; functions and statements; temp hygiene + tile rollback + pipeline re-validation; transform fragments), and PR 2 into about three (migration + self-check; session role + grants; dissolve write split). The first slice turns every reproduced bypass into a failing test.
