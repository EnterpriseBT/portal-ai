# Entity Records Wide-Table Storage — Phase 3 — Plan

**TDD-sequenced implementation of the phase-3 cut: the LLM's `sql_query` tool moves off AlaSQL onto Postgres-direct via per-call temp views; math methods pull from Postgres via a shared `fetchProjectedRows` helper; the `apply*` / `cache*` surface keeping AlaSQL coherent with database writes is deleted; the AlaSQL dependency disappears.**

Spec: `docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_3.spec.md`. Proposal: `docs/ENTITY_RECORDS_WIDE_TABLE.proposal.md`. Phase 2 plan: `docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_2.plan.md`. Audit: `docs/ENTITY_RECORDS_WIDE_TABLE.audit.md`.

The change is layered; **seven slices** (one slice 0 + six body slices), each behind a green test suite. Slices are ordered so each red→green loop tightens around one concern at a time and the system stays compilable between slices. Critically: the destructive AlaSQL surface deletion (slice 5) is sequenced **after** every reader of the in-memory station state has been migrated off it (slices 2–3) and the system prompt has been rewritten (slice 4), so deleting `stationDatabases` / `apply*` / `cache*` never silently breaks an unmigrated path.

Run tests with:

```bash
# from apps/api — never invoke jest directly (NODE_OPTIONS sets ESM)
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration

# whole-repo gates at slice boundaries
npm run lint
npm run type-check
```

Each slice follows the same loop:

1. Write failing tests for the slice's new behaviour.
2. Implement the smallest change that makes them pass.
3. Run focused tests; confirm green.
4. Run lint + type-check at slice boundary.
5. Move to the next slice.

The slices are sequenced so that:

- **Slice 0** lands the pure SQL utilities — `validatePortalSql`, `applyImplicitLimit`, `applyRowCap` / `applyCellCap` / `buildResponse`. No DB interaction, no callers yet, exhaustive unit coverage. Pure leaf.
- **Slice 1** adds `WideTableRepository.fetchProjectedRows`. Pure additive; nothing calls it yet outside its tests.
- **Slice 2** wires the new Postgres-direct path. `PortalSqlService.buildSessionViews` materialises the per-call temp view set; `PortalSqlService.runSqlQuery` orchestrates validate → wrap → execute → envelope inside a `READ ONLY` transaction. `AnalyticsService.sqlQuery` (and `visualize` / `visualizeVega`) now delegate to it. AlaSQL is **still** loaded into stations, but the LLM's `sql_query` tool no longer reads from it.
- **Slice 3** ports every math method (`describeColumn`, `correlate`, `regression`, etc.) from `records: any[]` to `connectorEntityId + columns + where?`, calling `fetchProjectedRows` for its data. Tool input schemas update in lockstep. After this slice, AlaSQL state is read by **nothing**.
- **Slice 4** rewrites `system.prompt.ts` for the Postgres surface — drops the metadata-tables paragraph and AlaSQL idioms, adds the PostgreSQL-compatible guidance block, preserves the per-entity schema dump and the `_record_id` / `_connector_entity_id` mention.
- **Slice 5** the comprehensive AlaSQL deletion. Removes `stationDatabases` and its lifecycle helpers, every `apply*` method (singletons and `…Many` bulk variants for records / entities / column-definitions / field-mappings), every `cache*` helper, `cleanup`, the `alasql` package. Slims `loadStation` to metadata-only. Strips post-write `apply*` calls from every mutation tool. After this slice, the AlaSQL dependency is physically removed from `package.json` and `node_modules`.
- **Slice 6** lands the eval / regression suite and the manual smoke run — 25 captured LLM SQL queries through the full pipeline, 10 fixed-seed math-method runs at machine-epsilon tolerance, and an end-to-end portal-session smoke.

After every slice, the repo type-checks, the existing test suite is green, and active portal sessions in dev continue to function (`sql_query` returns sensible rows, mutation tools persist writes, the LLM continues to see committed state on the next call).

---

## Slice 0 — Pure SQL utilities

A leaf-shaped trio of utilities, all I/O-free, fully unit-testable. Three new files, three new test files, ~33 test cases total (cases 1–33 from the spec). Nothing else changes.

**Why first.** These utilities are the building blocks slice 2 wires into the new `sql_query` execution path. Landing them first lets slice 2's tests focus on the orchestration shape (transaction, view set, error mapping) and trust the leaf validation / wrap / envelope semantics already covered here.

**Files**

- New: `apps/api/src/services/portal-sql-validation.util.ts` — `validatePortalSql(sql)` plus the comment-stripping state machine and the deny-list constants.
- New: `apps/api/src/services/portal-sql-limit.util.ts` — `applyImplicitLimit(sql, cap)` over `node-sql-parser`'s AST.
- New: `apps/api/src/services/portal-sql-response.util.ts` — `PORTAL_SQL_DEFAULTS`, `applyRowCap`, `applyCellCap`, `buildResponse`, the `PortalSqlResponse` discriminated union.
- New: `apps/api/src/__tests__/services/portal-sql-validation.util.test.ts` (cases 1–17).
- New: `apps/api/src/__tests__/services/portal-sql-limit.util.test.ts` (cases 18–25).
- New: `apps/api/src/__tests__/services/portal-sql-response.util.test.ts` (cases 26–33).
- Edit: `apps/api/src/constants/api-codes.constants.ts` — add `PORTAL_SQL_FORBIDDEN`, `PORTAL_SQL_TIMEOUT`.
- Edit: `apps/api/package.json` — verify `node-sql-parser` is present; add it if not.

**Steps**

1. **Verify `node-sql-parser` availability.** `cd apps/api && npm ls node-sql-parser`. If missing, `npm install node-sql-parser` and commit the lockfile delta as part of this slice.

2. **Add the API codes.** `PORTAL_SQL_FORBIDDEN` (deny-list trip; multi-statement; unbalanced literal; comment imbalance), `PORTAL_SQL_TIMEOUT` (Postgres `statement_timeout` fires) — both `<DOMAIN>_<FAILURE>` shaped per CLAUDE.md.

3. **Write `portal-sql-validation.util.test.ts` (cases 1–17).** One test per behaviour — bare `SELECT`, aggregations, every DML / DDL / side-effect verb, system-catalog access, multi-statement, comment stripping, string-literal `;` escape, unbalanced literal / comment, quoted-identifier `"INSERT INTO"` allowed. Run; all fail (no implementation).

4. **Implement `validatePortalSql`.** Three stages, in order:
   - **Strip comments** — line-by-line state machine over `--` and `/* */`. Track imbalance; raise `PORTAL_SQL_FORBIDDEN` with `"unbalanced comment"` on stray `*/` or unterminated `/*`. The output is a comment-free string used by the next stages.
   - **Multi-statement scan** — second state machine over the stripped string, tracking `'…'` and `"…"` contexts. Any `;` in the default state → `PORTAL_SQL_FORBIDDEN` with `"multi-statement input"`. Unbalanced `'` → `PORTAL_SQL_FORBIDDEN` with `"unbalanced string literal"`.
   - **Deny-list regex sweep** — one compiled `RegExp` for the reserved-verb set (`/\b(INSERT|UPDATE|…|FETCH|CLOSE|DECLARE)\b/i`), one for the system-catalog prefix set (`/\b(pg_(catalog|toast|temp|class|attribute|…)|information_schema)\b/i`). Each match → `PORTAL_SQL_FORBIDDEN` with the offending construct in the message (`"reserved verb: INSERT"` / `"system catalog access: pg_catalog"`).
   - **AST inspection for `needsImplicitLimit`** — parse via `node-sql-parser` (PostgreSQL dialect); inspect the top-level select's `limit` and `columns` array; `needsImplicitLimit = !limit && !hasTopLevelAggregation(columns)`. Parser failure → `needsImplicitLimit: true` (fail-open for the limit wrap; the deny-list above is the security gate).
   - Return `{ cleaned, needsImplicitLimit }`.

5. **Run cases 1–17.** Green.

6. **Write `portal-sql-limit.util.test.ts` (cases 18–25).** Wrap behaviour, aggregation pass-through, `ORDER BY`-without-`LIMIT` wrap, subquery aggregation does not exempt the top-level, CTE wrap, parser-failure passthrough. Run; all fail.

7. **Implement `applyImplicitLimit(sql, cap)`.** Parse via `node-sql-parser`. If the result is a single `select` AST without a `limit` clause and without an aggregation in the top-level select list (`{ type: 'aggr_func', name: 'COUNT'|… }` walker), return `{ sql: \`SELECT * FROM (${sql}) _q LIMIT ${cap + 1}\`, appliedLimit: cap + 1 }`. Otherwise return `{ sql, appliedLimit: null }`. Parser exception → `{ sql, appliedLimit: null }`.

8. **Run cases 18–25.** Green.

9. **Write `portal-sql-response.util.test.ts` (cases 26–33).** Defaults, row cap, cell cap on text/JSONB-as-text/array-as-text, numeric/boolean/date pass-through, payload cap → `{ truncated, sample, columnSizes, hint }`, `columnSizes` averages over full result set. Run; all fail.

10. **Implement the envelope helpers.**
    - `applyRowCap(rows, cap)` — `{ rows: rows.slice(0, cap), totalCount: rows.length, capped: rows.length > cap }`.
    - `applyCellCap(rows, cap)` — for each cell, if `typeof value === 'string'` and `Buffer.byteLength(value, 'utf8') > cap`, replace with `\`…<truncated, original \${n}b>\``. JSONB and arrays come back from pg as JS values; stringify only when over-cap (`JSON.stringify(value).length > cap`).
    - `buildResponse(rows, totalCount, capped, appliedLimit, payloadCap, sampleSize)`:
      1. Serialise the row-cap+cell-cap envelope. If `Buffer.byteLength(serialised) <= payloadCap`, return that envelope (with or without `truncated`).
      2. Otherwise return the payload-cap collapse: `{ truncated: true, sample: rows.slice(0, sampleSize), totalCount, columnSizes, hint: 'response exceeded …' }`. `columnSizes` = `Object.fromEntries(columns.map(c => [c, avgBytes(rows, c)]))`.
    - `PORTAL_SQL_DEFAULTS = { rowCap: 500, cellCap: 500, payloadCap: 100_000, truncatedSampleSize: 10 } as const`.
    - `PortalSqlResponse` discriminated union per the spec's "Truncation envelope shape" section.

11. **Run cases 26–33.** Green.

12. **Lint + type-check.** Clean.

**Done when:** cases 1–33 pass; the three util modules export the documented surface; no caller wires them up yet outside their own tests.

**Risk:**

- **`node-sql-parser` dialect mismatch.** The library bundles multiple SQL dialects; Postgres mode is required. Mitigation: instantiate with `new Parser()` and call `astify(sql, { database: 'postgresql' })` explicitly. Tested via case 22 (`ORDER BY` clause shape) and case 24 (CTE shape).
- **Parser bug on niche syntax.** A user query the deny-list otherwise accepts could trip the parser. The wrap returns `{ appliedLimit: null }` and the row cap in slice 0 catches the unbounded result. Case 25 exercises the fallback.

---

## Slice 1 — `fetchProjectedRows` helper

Leaf addition to the wide-table repository. Adds one method, four integration test cases (56–59 from the spec). Nothing reads from it yet.

**Why now.** Slice 3 (math-method port) consumes this helper. Landing it first lets slice 3's tests assert on the math behaviour without coupling to repo plumbing.

**Files**

- Edit: `apps/api/src/db/repositories/wide-table.repository.ts` — add `fetchProjectedRows(connectorEntityId, columns, opts, client?)`.
- Edit: `apps/api/src/__tests__/__integration__/db/repositories/wide-table.repository.integration.test.ts` — append cases 56–59.

**Steps**

1. **Write the integration tests (cases 56–59).** Each test seeds a single entity with N rows via the phase-2 sync write surface, then calls `fetchProjectedRows` with various `columns` / `opts` shapes:
   - Case 56: 5 rows, `columns: ['email', 'age']`, `limit: 5` → returns 5 rows with keys `_record_id`, `email`, `age` (normalized-key form).
   - Case 57: `where: sql\`"c_age" > 30\`` → only rows where age > 30.
   - Case 58: seed a soft-deleted row alongside the live ones → excluded.
   - Case 59: seed rows under a different `organization_id` → excluded by the opts filter.
   Run; all fail (method doesn't exist).

2. **Implement `fetchProjectedRows`.**

   ```ts
   async fetchProjectedRows(
     connectorEntityId: string,
     columns: ReadonlyArray<string>,
     opts: { organizationId: string; where?: SQL; limit?: number },
     client: DbClient = db
   ): Promise<Record<string, unknown>[]> {
     const stmt = await wideTableStatementCache.get(connectorEntityId, client);
     const tableName = `er__${connectorEntityId}`;

     const columnRefs = columns.map((nk) => {
       const ref = stmt.columnRefByNormalizedKey.get(nk);
       if (!ref) {
         throw new ApiError(
           ApiCode.ENTITY_RECORD_INVALID_FILTER,
           `unknown column: ${nk}`
         );
       }
       return sql`${sql.raw(ref("w"))} AS ${sql.identifier(nk)}`;
     });

     const where = sql.join(
       [
         sql`w.organization_id = ${opts.organizationId}`,
         sql`er.deleted IS NULL`,
         opts.where,
       ].filter(Boolean),
       sql` AND `
     );

     const limit = opts.limit ? sql` LIMIT ${opts.limit}` : sql``;

     const query = sql`
       SELECT w.entity_record_id AS "_record_id", ${sql.join(columnRefs, sql`, `)}
       FROM ${sql.identifier(tableName)} w
       JOIN entity_records er ON er.id = w.entity_record_id
       WHERE ${where}
       ${limit}
     `;

     return (await client.execute(query)).rows;
   }
   ```

   Notes: `columnRefByNormalizedKey` already exists from phase-2 slice 1 (`apps/api/src/services/wide-table-statement.cache.ts`). The `client.execute` shape is the same one phase-2's other repo methods use — keep consistent.

3. **Run cases 56–59.** Green.

4. **Lint + type-check.** Clean.

**Done when:** cases 56–59 pass; the new method is exported but called from nowhere outside its own tests.

**Risk:**

- **Unknown column key** — surfaces as `ENTITY_RECORD_INVALID_FILTER`. Already in the API-codes enum from phase 2's filter work; no new code needed.
- **Drizzle `sql.identifier` quoting for `er__<uuid>` table names.** Mitigation: case 56 actually executes a real query against a seeded wide table. If the identifier quoting is wrong, the test fails immediately.

---

## Slice 2 — View builder + `sqlQuery` Postgres-direct cutover

The orchestration slice. `PortalSqlService.buildSessionViews` materialises the per-call temp view set; `PortalSqlService.runSqlQuery` wires it together with the slice-0 utilities inside a `READ ONLY` transaction. `AnalyticsService.sqlQuery` delegates to it; `visualize` / `visualizeVega` call the new async `sqlQuery`. **AlaSQL is still loaded into stations, but the LLM's `sql_query` tool no longer reads from it.**

**Files**

- New: `apps/api/src/services/portal-sql.service.ts` — `buildSessionViews`, `runSqlQuery`, the `SessionViewBuild` interface, `PortalSqlParams` type.
- Edit: `apps/api/src/services/analytics.service.ts` — `sqlQuery` becomes a thin async wrapper around `PortalSqlService.runSqlQuery`; `visualize` and `visualizeVega` await the new shape; `validateSql` and `SQL_BLOCKLIST` delete (validation moved to slice 0's utility).
- New: `apps/api/src/__tests__/__integration__/services/portal-sql.service.integration.test.ts` (cases 34–55).

**Steps**

1. **Write the view-builder tests (cases 34–41).** Each test:
   - Seeds a station with N entities at varying read/write capability levels.
   - Calls `PortalSqlService.buildSessionViews(stationId, organizationId, tx)` inside a transaction.
   - Asserts on the resulting view DDL strings and the entity-key → view-name map.
   - Then executes the DDL strings and runs a probe `SELECT` against the view to confirm the projection.
   - Cases: read-capable entity produces a view (34); read-disabled entity is absent (35); `_record_id` / `_connector_entity_id` synthetic columns project correctly (36); each data column projects under its `c_*` name (37); metadata columns excluded (38); cross-org rows invisible (39); soft-deleted rows invisible (40); reconciler-added column appears on next build (41 — depends on phase 2's cache rebuild).
   Run; all fail.

2. **Implement `buildSessionViews`.**

   ```ts
   export interface SessionViewBuild {
     views: ReadonlyArray<string>;
     viewMap: ReadonlyMap<string, string>;
     parameters: ReadonlyArray<unknown>;
   }

   async function buildSessionViews(
     stationId: string,
     organizationId: string,
     client: DbClient = db
   ): Promise<SessionViewBuild> {
     const caps = await resolveEntityCapabilities(stationId, client);
     const readable = caps.filter((c) => c.read === true);

     const views: string[] = [];
     const viewMap = new Map<string, string>();

     for (const cap of readable) {
       const stmt = await wideTableStatementCache.get(cap.connectorEntityId, client);
       const dataColumns = stmt.columns.filter(
         (c) => !WIDE_TABLE_METADATA_COLUMNS.includes(c.columnName)
       );

       const projections = dataColumns
         .map((c) => `w."${c.columnName}"`)
         .join(", ");

       const viewName = cap.entityKey; // exposed identifier to the LLM
       const ddl = `
         CREATE TEMP VIEW "${viewName}" AS
         SELECT
           w.entity_record_id AS _record_id,
           '${cap.connectorEntityId}'::text AS _connector_entity_id,
           ${projections}
         FROM "er__${cap.connectorEntityId}" w
         JOIN entity_records er ON er.id = w.entity_record_id
         WHERE w.organization_id = $1
           AND er.deleted IS NULL
       `;
       views.push(ddl);
       viewMap.set(cap.entityKey, viewName);
     }

     return { views, viewMap, parameters: [organizationId] };
   }
   ```

   The `cap.connectorEntityId` literal is embedded into the view DDL (not parameterised) because Postgres doesn't allow parameterising identifiers. The value is a UUID from `entity_capabilities` — internal, never user-supplied — so SQL-injection risk is structurally absent. Defensive: validate it against `/^[0-9a-f-]{36}$/i` before interpolation, throw on mismatch.

3. **Run cases 34–41.** Green.

4. **Write the `runSqlQuery` tests (cases 42–55).** End-to-end behaviour through the new path:
   - 42 — `SELECT COUNT(*) FROM contacts` returns 1 row.
   - 43 — `WHERE c_age > 30 LIMIT 5` returns the right rows.
   - 44 — `_record_id` is non-null text per row.
   - 45 — JOIN across entities through the slice-0 `source_id` denormalisation.
   - 46 — implicit limit wrap fires; `appliedLimit: 501`.
   - 47 — row cap fires; `truncated: true`, `totalCount: 1000`.
   - 48–52 — every dangerous verb / multi-statement / pg_catalog rejected with `PORTAL_SQL_FORBIDDEN`.
   - 53 — cross-org leak attempt returns zero rows.
   - 54 — read-disabled entity: `"relation does not exist"` translated to `"unknown entity: <key>"`.
   - 55 — `statement_timeout` (gated behind `RUN_SLOW_TESTS=1`).
   Run; all fail.

5. **Implement `runSqlQuery`.**

   ```ts
   export interface PortalSqlParams {
     sql: string;
     stationId: string;
     organizationId: string;
     rowCap?: number;
     cellCap?: number;
     payloadCap?: number;
   }

   async function runSqlQuery(params: PortalSqlParams): Promise<PortalSqlResponse> {
     const caps = {
       rowCap: params.rowCap ?? PORTAL_SQL_DEFAULTS.rowCap,
       cellCap: params.cellCap ?? PORTAL_SQL_DEFAULTS.cellCap,
       payloadCap: params.payloadCap ?? PORTAL_SQL_DEFAULTS.payloadCap,
     };

     // 1. Validate (throws PORTAL_SQL_FORBIDDEN on violation).
     const { cleaned, needsImplicitLimit } = validatePortalSql(params.sql);

     // 2. Optionally wrap with implicit LIMIT.
     const { sql: wrapped, appliedLimit } = needsImplicitLimit
       ? applyImplicitLimit(cleaned, caps.rowCap)
       : { sql: cleaned, appliedLimit: null };

     // 3. Execute inside a READ ONLY transaction with the view set materialised.
     return await db.transaction(async (tx) => {
       await tx.execute(sql.raw("SET LOCAL transaction_read_only = on"));
       await tx.execute(sql.raw("SET LOCAL statement_timeout = '30s'"));

       const build = await buildSessionViews(params.stationId, params.organizationId, tx);
       for (const ddl of build.views) {
         await tx.execute(sql.raw(ddl), build.parameters);
       }

       // 4. Run the LLM SQL. Translate "relation does not exist" → unknown-entity hint.
       let rows: Record<string, unknown>[];
       try {
         rows = (await tx.execute(sql.raw(wrapped))).rows;
       } catch (err) {
         if (isUndefinedTableError(err)) {
           const missing = extractMissingRelationName(err);
           throw new ApiError(
             ApiCode.PORTAL_SQL_FORBIDDEN,
             `unknown entity: ${missing}`
           );
         }
         if (isStatementTimeoutError(err)) {
           throw new ApiError(ApiCode.PORTAL_SQL_TIMEOUT, "query timed out (30s)");
         }
         throw err;
       }

       // 5. Apply envelope.
       const { rows: capped, totalCount, capped: rowCapped } = applyRowCap(rows, caps.rowCap);
       const cellCapped = applyCellCap(capped, caps.cellCap);
       return buildResponse(
         cellCapped,
         totalCount,
         rowCapped,
         appliedLimit,
         caps.payloadCap,
         PORTAL_SQL_DEFAULTS.truncatedSampleSize
       );
     });
   }
   ```

   `isUndefinedTableError` matches `error.code === '42P01'`; `extractMissingRelationName` parses `error.message` for `relation "<name>" does not exist`. `isStatementTimeoutError` matches `error.code === '57014'`.

6. **Edit `analytics.service.ts:sqlQuery`.** Replace the body with `return await PortalSqlService.runSqlQuery(params)`. Delete `validateSql` and `SQL_BLOCKLIST` (the validation lives in slice 0's util). The method becomes async; callers (`visualize`, `visualizeVega`, the `data_query` tool) already `await` it on the tool side — verify with a grep that no caller treats the return as sync. (Today's `sqlQuery` returns `unknown` from a sync AlaSQL call; `await` over a non-promise is a no-op, so the caller change is one keyword.)

7. **Run cases 42–55.** Green (modulo case 55 only with `RUN_SLOW_TESTS=1`).

8. **Lint + type-check.** Clean.

**Done when:** the new path serves `sql_query`; AlaSQL still preloads stations but the tool no longer touches its in-memory state; all 22 cases in this slice pass.

**Risk:**

- **`buildSessionViews` cost in a 100-entity station.** Each entity is one `CREATE TEMP VIEW`. At ~5 ms per view that's ~500 ms per call. Mitigation: measure during slice 6's smoke; if the cost matters, the optimisation is "issue the DDL strings as a single multi-statement via the pg driver" (the driver does the right thing for a single `query` call with multiple `;`-separated statements). For phase 3's typical workload (a handful of entities per station), the per-call cost is sub-10 ms.
- **`SET LOCAL transaction_read_only = on` ordering.** It must precede every other statement in the transaction. Mitigation: the implementation issues it as the very first `tx.execute`; case 48 (an `INSERT` attempt) confirms even a deny-list bypass fails at the database level.
- **`pg` error-code matching.** `42P01` is stable across Postgres versions; `57014` (`statement_timeout`) is stable. Mitigation: hard-coded matchers; documented in a comment at the top of the helpers.
- **Active sessions during deploy.** Because `sql_query` is now async and the `data_query` tool already awaits its result, no client-side change is needed. Sessions in flight resume cleanly against the new path.

---

## Slice 3 — Math-method port

Every math method takes `connectorEntityId + columns + where?` and fetches its rows from Postgres via `fetchProjectedRows`. The records-array signature stays as an internal overload for revalidation / test fixtures. Tool input schemas update in lockstep so the LLM sees the new shape on the next render. After this slice, **nothing reads AlaSQL state** — but the AlaSQL surface is still present (slice 5 deletes it).

**Files**

- Edit: `apps/api/src/services/analytics.service.ts` — `describeColumn`, `correlate`, `outliers`, `cluster`, `regression`, `logisticRegression`, `trend`, `forecast`, `decompose`, `changepoint`, `hypothesisTest`, `aggregate`, `technicalIndicator`, `resolveIdentity`. The financial methods (`npv`, `irr`, `xnpv`, `xirr`, `depreciation`, `tvm`, `bondMath`, `portfolioMetrics`, `varCvar`, `amortize`, `sharpeRatio`, `maxDrawdown`, `rollingReturns`) stay records-shaped — they never read from the database.
- Edit: `apps/api/src/tools/describe-column.tool.ts`, `correlate.tool.ts`, `regression.tool.ts`, `forecast.tool.ts`, `decompose.tool.ts`, `changepoint.tool.ts`, `trend.tool.ts`, `technical-indicator.tool.ts`, `aggregate.tool.ts`, `cluster.tool.ts`, `outliers.tool.ts`, `hypothesis-test.tool.ts`, `logistic-regression.tool.ts`, `resolve-identity.tool.ts` — input schemas swap `records: any[]` for `connectorEntityId: string + columns: string[] + where?: string`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — cases 60–65.
- Edit: `apps/api/src/__tests__/tools/{describe-column,correlate,…}.tool.test.ts` — cases 72–73 across the affected tool tests.

**Steps**

1. **Write the math-method tests (cases 60–65).**
   - 60 — `describeColumn({ connectorEntityId, columns: ['amount'], organizationId })` matches the records-array form on the same seeded data.
   - 61 — `correlate` matches AlaSQL-era values to ±1e-9 on a fixed-seed dataset.
   - 62 — `regression` matches to ±1e-9.
   - 63 — `forecast` matches to ±1e-9 on a 100-row time series.
   - 64 — each method handles an empty result set (no rows) with the existing structured empty result.
   - 65 — `fetchProjectedRows` mock asserts the call shape (right `connectorEntityId` / `columns` / `organizationId`).
   Run; cases 60–63 fail (signature mismatch); case 65 fails (no call yet).

2. **Add the connector-entity-driven overload to each method.** Pattern, repeated for every method:

   ```ts
   static async describeColumn(
     params:
       | { records: any[]; column: string; … }
       | { connectorEntityId: string; columns: [string]; organizationId: string; where?: SQL; … }
   ): Promise<DescribeColumnResult> {
     const rows = "records" in params
       ? params.records
       : await wideTableRepo.fetchProjectedRows(
           params.connectorEntityId,
           params.columns,
           {
             organizationId: params.organizationId,
             where: params.where,
             limit: DESCRIBE_COLUMN_LIMIT,
           }
         );
     return computeDescribeColumn(rows, /* column key from params */, …);
   }
   ```

   `DESCRIBE_COLUMN_LIMIT` (etc.) — per-method row caps to bound memory pressure; defaults match today's effective behaviour. Each method documents its cap in a one-line comment if non-obvious; default is `null` (no cap) for methods that already aggregate cheaply.

3. **Run cases 60–65.** Green.

4. **Update tool input schemas (cases 72–73).** Each math tool's Zod schema swaps `records: z.array(z.unknown())` for `connectorEntityId: z.string().uuid()` + `columns: z.array(z.string()).min(1)` + `where: z.string().optional()`. The tool's implementation passes them through. Tests:
   - 72 — new shape parses green.
   - 73 — old records-array shape rejected.
   Implement; run tool tests; green.

5. **Run focused tests.** `cd apps/api && npm run test:unit -- analytics.service && npm run test:unit -- tools`. Green.

6. **Lint + type-check.** Clean.

**Done when:** every analytics method that today walks records exposes the connector-entity overload as its primary; every math tool's input schema takes the new shape; AlaSQL state is still loaded but nothing reads it.

**Risk:**

- **A math method's existing test relies on `records`-shape behaviour for non-database fixtures.** The records-array overload stays as the second signature; in-repo tests that construct synthetic rows continue to work unchanged.
- **Numeric divergence between AlaSQL and Postgres.** Cases 61–63 catch this at ±1e-9. If a method diverges (typically: Postgres `numeric` vs JS `number` precision on financial methods), the fix is to issue the projection as `::double precision` from Postgres before the JS math runs. Documented in the test failure.
- **`where: string` deserialisation.** The tool accepts `where` as a raw SQL fragment. Slice 0's `validatePortalSql` doesn't apply (it's for `sql_query`). The risk is the LLM passing a malicious `where`. Mitigation: `where` is appended to a `WHERE w.organization_id = $1 AND er.deleted IS NULL` prefix; even if the LLM writes `1=1 OR DROP TABLE`, the outer transaction is `READ ONLY` and the parsed SQL fails. Belt: pass `where` through `validatePortalSql`'s deny-list scan (just the regex layer) before stitching. Document in code.

---

## Slice 4 — `system.prompt.ts` rewrite

The schema dump stays. The metadata-tables paragraph drops. The AlaSQL idioms drop. A new "PostgreSQL-compatible SQL" guidance block lands. Four test cases (74–77).

**Why before slice 5.** Slice 5 deletes the AlaSQL surface comprehensively, which is the slice that affects every active portal-session deploy. The prompt rewrite has to land first so the next session boot under the new code reads sensible guidance.

**Files**

- Edit: `apps/api/src/prompts/system.prompt.ts`.
- Edit: `apps/api/src/__tests__/prompts/system.prompt.test.ts` — cases 74–77.

**Steps**

1. **Write the prompt tests (cases 74–77).**
   - 74 — rendered prompt no longer contains `_connector_instances`, `_column_definitions`, `_field_mappings`, `_connector_entities`.
   - 75 — rendered prompt still mentions `_record_id` and `_connector_entity_id`.
   - 76 — rendered prompt contains the new SQL-guidance block (key phrases: `LIMIT`, `SELECT *`, aggregation, double-quote identifiers).
   - 77 — the `[read, write]` capability tag still renders per entity.
   Run; cases 74 and 76 fail.

2. **Edit `system.prompt.ts`.**
   - Drop the metadata-tables paragraph (`_connector_instances`, etc.).
   - Drop the AlaSQL bracket-quoting examples in the example queries.
   - Drop any "the session sees its own writes immediately because of an in-memory layer" wording.
   - Keep: the per-entity heading, the column list, the `[read, write]` tag, the `_record_id` / `_connector_entity_id` mention, mutation-tool guidance.
   - Add (new "SQL guidance" block before the tool guidance):

     ```
     This is PostgreSQL-compatible SQL. Specifically:
     - Always include a LIMIT clause when scanning rows for exploratory work.
     - Avoid `SELECT *` on entity tables — project only the columns you need.
     - Prefer aggregations (COUNT, AVG, MAX, SUM) over scanning rows when the
       user is asking summary questions.
     - Responses cap at 500 rows. If you see `truncated: true` in the response,
       narrow your filter or aggregate instead of paging.
     - Quote identifiers with double quotes (`"name"`), not brackets.
     ```

3. **Run cases 74–77.** Green.

4. **Lint + type-check.** Clean.

**Done when:** the prompt reflects the Postgres-direct surface; the metadata-tables paragraph is gone; the new guidance block is in place.

**Risk:**

- **A snapshot test elsewhere encodes the old prompt text.** `grep -rn "_connector_instances" apps/api/src` confirms — should only be in the prompt source (now removed) and its own test. If a fixture references the old text, regenerate at this slice boundary.

---

## Slice 5 — AlaSQL surface deletion (comprehensive cut)

The destructive slice. After this point, AlaSQL is gone from `package.json`, `node_modules`, and source. `stationDatabases` deletes; every `apply*` and `cache*` deletes; `cleanup` deletes; `loadStation` slims to metadata-only; every mutation tool drops its post-write `apply*` calls.

**Why this can be one slice.** After slices 2 + 3 + 4, nothing in the system reads from or writes to AlaSQL state. The map is dead weight. Deleting it is a structural cleanup, not a behaviour change.

**Files**

- Edit: `apps/api/src/services/analytics.service.ts` — strip every AlaSQL hook; slim `loadStation` to metadata-only; drop `loadRecords` (or rename + retarget if a caller remains).
- Edit: `apps/api/src/services/portal.service.ts` — drop any `AnalyticsService.cleanup` call site (the audit suggests none exists; deletion is defensive).
- Edit: `apps/api/src/tools/entity-record-create.tool.ts` — drop post-write `apply*` calls.
- Edit: `apps/api/src/tools/entity-record-update.tool.ts` — same.
- Edit: `apps/api/src/tools/entity-record-delete.tool.ts` — same.
- Edit: `apps/api/src/tools/field-mapping-create.tool.ts` — same.
- Edit: `apps/api/src/tools/field-mapping-update.tool.ts` — same.
- Edit: `apps/api/src/tools/field-mapping-delete.tool.ts` — same.
- Edit: `apps/api/src/tools/connector-entity-create.tool.ts` — same.
- Edit: `apps/api/src/tools/connector-entity-update.tool.ts` — same.
- Edit: `apps/api/src/tools/connector-entity-delete.tool.ts` — same.
- Edit: `apps/api/package.json` — remove the `alasql` dependency.
- Edit: `apps/api/package-lock.json` — regenerated by the install step.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — cases 66–69.
- Edit: `apps/api/src/__tests__/tools/{entity-record-create,update,delete,field-mapping-create,…,connector-entity-delete}.tool.test.ts` — cases 70–71.

**Steps**

1. **Write the deletion tests (cases 66–71).**
   - 66 — `AnalyticsService.stationDatabases` is no longer exported (compile-time check; if the import in this file fails, the test errors at module load).
   - 67 — `applyRecordInsertMany` (and the rest of the `apply*` surface) is no longer a method on `AnalyticsService`.
   - 68 — `loadStation(stationId, organizationId)` returns `{ entities, entityGroups }` without any row data — spy on the connection pool; no row reads at the entity-record level during load.
   - 69 — `alasql` is not in `apps/api/package.json` (`grep '"alasql"' package.json` returns no match — run inside the test via fs read).
   - 70 — each of the 9 mutation tools no longer calls `AnalyticsService.apply*` (spy on the service module; expected calls = 0).
   - 71 — after a mutation tool persists a write, an immediate `sql_query` SELECT sees the updated row (Postgres source of truth; no caching layer to be coherent with).
   Run; all fail (the symbols still exist; the tools still call them; the dependency is present).

2. **Strip the mutation tools.** In each of the 9 tools, delete the post-write `AnalyticsService.apply*Many(stationId, …)` call. The order of operations becomes:
   1. Validate request.
   2. `assertWriteCapability` (unchanged).
   3. Write to Postgres via the appropriate repository (phase 2 already wired this).
   4. Return success.

   No commits should reference `AnalyticsService.apply*` anywhere after this step.

3. **Strip `analytics.service.ts`.**
   - Delete the `alasql` import at the top of the file.
   - Delete the `stationDatabases` Map declaration, `getOrCreateDatabase`, `dropDatabase`.
   - Delete every `apply*` method: `applyRecordInsert/Update/Delete`, `applyEntityInsert/Update/Delete`, `applyColumnDefinitionInsert/Update/Delete`, `applyFieldMappingInsert/Update/Delete`, and every `…Many` bulk variant.
   - Delete every `cache*` helper: `cacheInsert`, `cacheUpsert`, `cacheDelete`, `cacheBatchInsert`, `cacheBatchUpsert`, `cacheBatchDelete`.
   - Delete `cleanup(stationId)`.
   - Rewrite `loadStation(stationId, organizationId)` to metadata-only:

     ```ts
     static async loadStation(
       stationId: string,
       organizationId: string
     ): Promise<StationData> {
       const station = await stationsRepo.findById(stationId);
       const reachableEntities = await this.discoverReachableEntities(station);
       const entities = reachableEntities.map(toEntitySchema);
       const entityGroups = await this.discoverEntityGroups(station);
       return { entities, entityGroups };
     }
     ```

     No `loadRecords`, no AlaSQL `CREATE TABLE`/`INSERT`, no `apply*` priming.

   - Delete `loadRecords` if no caller remains. Run `grep -n loadRecords apps/api/src` — the audit notes only `data_query`, `visualize`, `visualizeVega` reached it pre-phase-3; all three now go through `sqlQuery` directly. Confirm grep shows no remaining caller; delete.

4. **Strip `portal.service.ts`.** Delete any `AnalyticsService.cleanup(stationId)` call. The audit doc says no such call exists today; running a grep at this step is the verification (`grep -n "AnalyticsService.cleanup" apps/api/src` → empty).

5. **Remove the dependency.** Edit `apps/api/package.json` — delete the `alasql` line under `dependencies`. From `apps/api`, run `npm install --package-lock-only` to regenerate the lockfile without `alasql`. Run `npm prune` if needed to clear `node_modules`.

6. **Run the deletion tests (cases 66–71).** Green.

7. **Run the full unit + integration suite.** `cd apps/api && npm run test:unit && npm run test:integration`. Everything green.

8. **Lint + type-check.** Clean. Any orphan import to `alasql` or `AnalyticsService.cache*` / `AnalyticsService.apply*` surfaces here as a compile error.

9. **Final structural greps (acceptance criteria from the spec).**
   - `grep -rn "alasql" apps/api/src` → zero matches.
   - `grep -rn "stationDatabases\|getOrCreateDatabase\|applyRecord\|applyEntity\|applyFieldMapping\|applyColumnDefinition\|cacheInsert\|cacheUpsert\|cacheBatchInsert" apps/api/src` → matches only in tests that assert these symbols are gone.
   - `cd apps/api && grep -c '"alasql"' package.json` → `0`.

**Done when:** the AlaSQL dependency is physically removed from `package.json` and `node_modules`; every `apply*` / `cache*` / lifecycle helper is gone from `analytics.service.ts`; `loadStation` returns metadata-only; every mutation tool reads Postgres as the source of truth; cases 66–71 pass alongside the full pre-existing suite.

**Risk:**

- **An untested code path still references `AnalyticsService.apply*` or `stationDatabases`.** The structural greps in step 9 catch this. Type-check at step 8 catches any compile-level reference. The slice's gate is "all greps clean, all tests green".
- **A mutation tool's "read your own write" semantics depended on `apply*` for in-session coherence.** Case 71 explicitly exercises this path. Postgres handles read-after-write naturally (committed writes are immediately visible). If a tool used `apply*` for any other reason than AlaSQL coherence, the audit caught it in phase 2 (none did).
- **`loadStation`'s caller in `portal.service.ts` destructures fields no longer returned.** Mitigation: `entities` and `entityGroups` are kept; `entityCapabilities` / `toolPacks` are loaded by `portal.service.ts` directly today, not by `loadStation`. Verify with grep at this step.

---

## Slice 6 — Eval / regression suite + manual smoke

The final gate. 25 captured LLM-generated SQL queries through the full pipeline. 10 fixed-seed math-method runs at machine-epsilon tolerance. Manual end-to-end smoke in dev.

**Files**

- New: `apps/api/src/__tests__/__integration__/services/analytics-postgres-eval.integration.test.ts` (cases 78–79).
- New: `apps/api/src/__tests__/__integration__/fixtures/portal-sql-eval.fixtures.json` — 25 captured SQL queries, each annotated with `{ description, sql, expectedRowCountRange: [min, max], expectedEnvelope: 'plain' | 'row-cap' | 'payload-cap' | 'rejected' }`.

**Steps**

1. **Capture the 25 SQL queries.** Source: prior portal-session test fixtures + any `data_query` calls in the existing analytics test suite. Each fixture entry records:
   ```json
   {
     "description": "count contacts over 30",
     "sql": "SELECT COUNT(*) FROM contacts WHERE c_age > 30",
     "expectedRowCountRange": [1, 1],
     "expectedEnvelope": "plain"
   }
   ```
   Cover: bare SELECTs (`expectedEnvelope: 'row-cap'` if rowcount > cap), aggregations (`'plain'`), JOINs (slice-0 source_id), every deny-list verb (`'rejected'`).

2. **Write the eval test (case 78).** Iterates the fixture set; for each entry, calls `PortalSqlService.runSqlQuery` and asserts:
   - `expectedEnvelope === 'plain'` → response has `rows`, no `truncated`.
   - `expectedEnvelope === 'row-cap'` → response has `truncated: true`, row count is the cap, `totalCount` in `expectedRowCountRange`.
   - `expectedEnvelope === 'payload-cap'` → response collapses to `{ truncated, sample, columnSizes }`.
   - `expectedEnvelope === 'rejected'` → throws `PORTAL_SQL_FORBIDDEN` (or `PORTAL_SQL_TIMEOUT`).

3. **Write the numeric-tolerance test (case 79).** 10 fixed-seed datasets (10–1000 rows each), each exercising one math method:
   - `describeColumn(amount)` on a 100-row uniform distribution.
   - `correlate(x, y)` on 100 rows with a known correlation of 0.7.
   - `regression(x, y)` on a 200-row noisy linear fit.
   - `forecast(timestamp, value)` on a 100-row sine wave.
   - `decompose`, `changepoint`, `trend`, etc. — one fixture each.
   
   Each assertion is `expect(Math.abs(actual - expected) < 1e-9).toBe(true)` against a pre-recorded AlaSQL-era value (computed once during fixture authoring, committed alongside the test).

4. **Run the eval tests.** `cd apps/api && npm run test:integration -- analytics-postgres-eval`. Cases 78–79 green.

5. **Run the full suite as a final gate.** `cd apps/api && npm run test:unit && npm run test:integration`. Green. `npm run lint && npm run type-check` from repo root. Clean.

6. **Manual smoke against dev.**
   - `cd apps/api && npm run dev`.
   - Open the web app at http://localhost:3000; navigate to a station with seeded entity records.
   - Open a portal session that exercises `sql_query`.
     - Confirm the LLM runs `SELECT _record_id, c_email FROM contacts WHERE c_age > 30 LIMIT 10`; response contains real Postgres rows.
     - Confirm `INSERT INTO contacts (...) VALUES (...)` from the LLM fails with `PORTAL_SQL_FORBIDDEN` and a descriptive message.
     - Confirm `SELECT * FROM pg_tables` fails with `"system catalog access"`.
   - In the same session, run `entity_record_update` against one of the SELECTed records; confirm the next `sql_query` shows the updated value (Postgres source of truth; no caching invalidation needed).
   - Hand-craft a cross-org leak attempt: `SELECT * FROM contacts WHERE organization_id = '<other-org-uuid>'`. Confirm zero rows (the view's outer `WHERE w.organization_id = $1` wins).
   - Confirm cold-session boot time: `time curl -X POST http://localhost:3001/api/portals -d '{"stationId":"<station-with-100k-records>"}' -H 'Content-Type: application/json'` returns in <100 ms (vs multi-second pre-phase-3).

7. **Re-confirm the acceptance-criteria checkboxes** from the spec section "Acceptance criteria". Every check should be satisfied at this point.

**Done when:** cases 78–79 pass; the manual smoke matches every acceptance-criteria checkbox in the spec; the deploy is ready.

**Risk:**

- **A fixture captures an AlaSQL-only idiom** (e.g. bracket-quoted identifier `[name]` instead of `"name"`). Expected — that fixture's expected envelope is `'rejected'` and the test confirms the LLM-visible error gives the new prompt's guidance a path to self-correct. (If the eval treats `[name]` as a valid pre-phase-3 idiom the LLM still generates, slice 4's prompt rewrite handles the symptom; this is the eval surfacing the right behaviour.)
- **Numeric divergence beyond ±1e-9 on a math method.** Recorded as a failing assertion. Investigation: typically a `numeric` vs `double precision` precision drift. Fix in slice 3's projection by casting at `fetchProjectedRows` time. If the divergence is intrinsic to the math (rare), document the new tolerance band and update the assertion — the test failure is the right alert.
- **A `RUN_SLOW_TESTS=1`-gated case (test 55) reveals `statement_timeout` doesn't fire as expected.** Investigation: the `SET LOCAL statement_timeout = '30s'` interaction with `READ ONLY` transactions has known quirks across Postgres versions. Mitigation: also `SET LOCAL idle_in_transaction_session_timeout = '30s'` if needed; the fallback safety stop.

---

## Cross-slice gates

After each slice:

1. `cd apps/api && npm run test:unit && npm run test:integration` is green.
2. `npm run lint && npm run type-check` from repo root are clean.
3. `git diff --stat` matches the slice's "Files" list (within reason).
4. The portal-session contract (the tools and their response shapes) is unchanged from the LLM's perspective. The `sqlQuery` response gains the truncation envelope fields, which the LLM consumes as plain text — no SDK / web schema work.

After slice 3, before slice 4:

- `grep -rn "AnalyticsService\.\(apply\|cache\)" apps/api/src` returns **zero** matches outside `analytics.service.ts` itself.
- `grep -rn "stationDatabases" apps/api/src` returns matches **only** inside `analytics.service.ts`.
- This is the gate that says "slice 5's destructive cut is safe to run".

After slice 5, before slice 6:

- `grep -rn "alasql\|stationDatabases\|getOrCreateDatabase\|applyRecord\|applyEntity\|applyFieldMapping\|applyColumnDefinition\|cacheInsert\|cacheUpsert\|cacheBatchInsert" apps/api/src` returns matches **only** in deletion assertion tests.
- `cd apps/api && grep -c '"alasql"' package.json` is `0`.
- `ls apps/api/node_modules/alasql 2>&1 | grep -q "No such file"` succeeds.

After slice 6 (phase end):

- All 79 spec test cases pass.
- All 9 acceptance-criteria checkboxes from the spec are satisfied.
- Manual `npm run dev` + portal-session smoke reproduces the pre-phase-3 LLM-facing behaviour, plus the new envelope semantics, plus the stricter validation guard.
- Cold-session boot time on a 100k-record station is sub-100 ms.
- No portal session in dev holds a `stationDatabases` entry (the map is gone).

---

## What this plan does *not* attempt

- **Retired-column drop maintenance** and **type-change backfill stager.** Phase 4.
- **Schema-per-org partitioning.** Out of v1.
- **Columnar mirror (Citus / DuckDB / ClickHouse).** Out of v1.
- **Cross-org analytics views.** Out of v1.
- **Eliminating the raw `data` JSONB on `entity_records`.** Stays — the audit trail of what the connector delivered before mapping.
- **`sqlQuery` write paths.** Phase 3 makes the surface strictly read-only. Mutations stay on the tool path with `assertWriteCapability`.
- **Web-app changes.** Zero — the portal-session response shape change is additive (`truncated`, `totalCount`, `sample`, `appliedLimit`); the web renderer already passes unknown fields through.
- **Storybook changes.** Zero.
- **New env vars, queues, streams, or infra.** Zero.
