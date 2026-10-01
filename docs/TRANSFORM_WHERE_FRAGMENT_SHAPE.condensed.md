# Transform WHERE fragment stays an AND-only filter — Condensed design (#669)

**Issue:** [EnterpriseBT/portal-ai#669](https://github.com/EnterpriseBT/portal-ai/issues/669) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `transform_entity_records` takes an agent-supplied `sourceFilter.whereSqlFragment`. `BulkTransformService.fetchSourceBatch` splices it as `WHERE "organization_id" = '<org>' AND (<fragment>)`. Both checks validate *contents*:
- the pre-flight (`parsePortalSqlExpression`, kind `"where"`), on `SELECT 1 FROM __source WHERE (<fragment>)`;
- the exact-SQL re-check (`assertTransformSql` → `assertScalarOver`): one SELECT, no sub-select, only the source relation, allowlisted functions.

Neither checks *structure*. A fragment that closes the parenthesis and opens an `OR` branch stays balanced and passes both. It then restructures the WHERE so the org predicate is OR'd rather than AND'd. Impact is low: the source is the entity's own `er__` table (one org), and the relation and function gates hold. But the contract is "a filter can only narrow". Package: `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Fragment pre-flight | `portal-sql-parse.util.ts:655–668` (`parsePortalSqlExpression`) | wraps `where` as `SELECT 1 FROM __source WHERE (<fenced fragment>)`; contents-only checks |
| Contents check | `portal-sql-parse.util.ts:675–697` (`assertScalarOver`) | statement type, no sub-select, no qualified names, only the source relation |
| Runtime splice | `bulk-transform.service.ts:252–257` (`fetchSourceBatch`) | `WHERE org = … AND (<fenced fragment>) ORDER BY … LIMIT … OFFSET …` |
| Exact-SQL re-check | `bulk-transform.service.ts:37–41` (`assertTransformSql`) | the same contents-only checks on the final SQL |
| Tool pre-flight call | `tools/transform-entity-records.tool.ts:333–340` | `parsePortalSqlExpression(..., "where")` before EXPLAIN / enqueue |

## Decision — assert the WHERE's tree shape, not just its contents

- **A. Structural check in the parse tree.** Postgres's raw parse keeps the distinction the text loses. `TRUE AND (<f>)` is an `AND` of **exactly two** args when `<f>` stays inside its parentheses, even if `<f>` contains `OR` or its own `AND` (a parenthesised sub-expression is one arg). An escaping fragment turns the root into an `OR`, or adds a third `AND` arg. Verified against libpg-query 17: `TRUE AND (x > 1)` → AND/2; `TRUE AND (x > 1 OR y < 2)` → AND/2; the escaping shape → OR at the root.
- **B. Re-parse the fragment standalone as an expression** (`SELECT (<f>)`). It doesn't work: the escaping shape is itself a valid standalone expression.
- **C. Reject `)` in fragments textually.** Brittle (parentheses inside strings and function calls are legitimate) and regex-shaped. That's the approach #660 moved away from.

**Decision: A, at both layers.**
1. **Pre-flight:** `parsePortalSqlExpression(f, "where")` wraps as `SELECT 1 FROM __source WHERE TRUE AND (<fenced f>)` and asserts the root of `whereClause` is `BoolExpr AND_EXPR` with exactly 2 args, the first the `TRUE` sentinel (`A_Const` boolean).
2. **Exact-SQL re-check:** `fetchSourceBatch` asserts the final statement's `whereClause` is `AND_EXPR` with exactly 2 args. The first must be the server's org predicate (an `A_Expr =` whose left side is the `organization_id` ColumnRef). Without a fragment it must be that predicate alone. Defence in depth for a queued job that bypassed the tool.

A shared helper `assertAndOfTwo(statement, isFirst)` in `portal-sql-parse.util.ts` serves both, throwing `PORTAL_SQL_FORBIDDEN` "the source filter must be a single condition". A fragment that merely ANDs more conditions *outside* its parentheses (harmless, but outside the contract) is also refused (3 args). The agent can write the same thing inside one expression.

## Plan — one slice

**Files**
- Edit: `apps/api/src/services/portal-sql-parse.util.ts`: the `where` wrapper gains the `TRUE AND (…)` sentinel; add an exported `assertAndOfTwo` and use it in `parsePortalSqlExpression` for `kind === "where"`.
- Edit: `apps/api/src/services/bulk-transform.service.ts`: after `assertTransformSql` in `fetchSourceBatch`, assert the WHERE's shape with the org-predicate check.

**Tests** (failing first)
- `apps/api/src/__tests__/services/portal-sql-parse.util.test.ts`:
  - **Allowed:** `c_a > 1`, `c_a > 1 OR c_b < 2`, `(c_a > 1) AND (c_b < 2)` and `c_a IN (1, 2)` (parentheses inside the expression).
  - **Rejected:** the escaping shape (closing then reopening the wrapper's parenthesis with `OR`) and an AND-escape, each with the single-condition error.
- `apps/api/src/__tests__/__integration__/services/bulk-transform-sql-gate.integration.test.ts`: `fetchSourceBatch` refuses the escaping fragment with `PORTAL_SQL_FORBIDDEN` before any query. The existing commented-fragment case still reaches Postgres (42P01).
- `apps/api/src/__tests__/tools/transform-entity-records.tool.test.ts`: the tool rejects the escaping fragment before EXPLAIN, with no job enqueued.
- `npm run test:unit` and `npm run test:integration -- --testPathPattern "bulk-transform|transform-entity"`, `type-check`, `lint`.

## Smoke (manual, against your dev stack)

1. As an admin, run a transform with a normal filter (e.g. `c_amount > 0 OR c_amount IS NULL`). The job runs and writes the expected rows.
2. The same with a fragment that closes the parenthesis and adds an `OR` branch. It's rejected before any job (`PORTAL_SQL_FORBIDDEN`, "single condition"), and no `jobs` row is created.
3. A filter using parentheses legitimately (`c_status IN ('a','b') AND (c_amount > 10)`). It runs.

## Out of scope

- A structural check on the **projection** fragment. Any escape there leaves the following ` FROM …` unparseable, and the relation gate holds.
- Changing the transform's org scoping (the `er__` table is already per-entity).
