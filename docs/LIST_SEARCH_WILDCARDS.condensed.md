# List searches treat % and _ as wildcards — Condensed design (#1039)

**Issue:** [EnterpriseBT/portal-ai#1039](https://github.com/EnterpriseBT/portal-ai/issues/1039) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Every list search builds `ilike(col, `%${search}%`)` without escaping, so a search for `%` or `_` matches every row the caller can see. `Q1_2025` also matches `Q1X2025`, and `50%` matches anything starting with `50`. Since #1036 the agent resolves a station by name through the same search, so a loose match can make it pick the wrong station. Nothing leaks: org and visibility filters are separate, and the value is a bound parameter. The fix is in `apps/api` only. The `search` parameter keeps its meaning and now matches literally.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Escape helper | `apps/api/src/utils/filter-sql.util.ts:392` (`escapeLike`) | Escapes `\ % _`. Record filters use it with `ESCAPE '\\'` (`:274-280`) |
| Already correct | `routes/entity-record.router.ts:283-288` | `escapeLike` + `ESCAPE '\\'` on raw SQL |
| Already correct | `services/portal-sql.service.ts:985` | Escapes with its own inline regex (raw-string SQL, default backslash escape) |
| Unescaped | `services/station-query.service.ts:54` | Station list (web + `station_list` tool) |
| Unescaped | `services/curated-view.service.ts:374-375, 468` | View entities + view list |
| Unescaped | `services/rbac-object-search.service.ts:135` | Access-authoring object picker |
| Unescaped | `routes/connector-entity.router.ts:189-190`, `entity-tag.router.ts:116-117`, `field-mapping.router.ts:203-204`, `column-definition.router.ts:156-157`, `entity-group.router.ts:149-150`, `jobs.router.ts:156-157`, `portal-results.router.ts:480`, `connector-instance.router.ts:218`, `connector-definition.router.ts:147` | Route list searches |
| Unescaped | `db/repositories/tool-usage-ledger.repository.ts:86` | Usage ledger search |

## Decision: one `ilikeContains` helper plus a guard

Options:
- (a) Wrap each value in `escapeLike` at all 21 sites. This is the smallest diff, but every new search has to remember to do it, and that's how this bug happened.
- (b) Add one helper that owns the pattern and the escape clause, use it everywhere, and add a guard test.

**Chosen: (b).** Add `ilikeContains(column: SQLWrapper, term: string): SQL` to `filter-sql.util.ts`. It returns ``sql`${column} ILIKE ${"%" + escapeLike(term) + "%"} ESCAPE '\\'` ``. Spelling `ESCAPE` out means the query doesn't depend on Postgres's implicit default.
- All 21 sites switch to it.
- `entity-record.router.ts` switches too.
- `portal-sql.service.ts` builds raw strings (`quoteLiteral`), so it can't take an `SQL` fragment. It keeps its raw-string shape but calls `escapeLike` instead of the duplicate regex.
- The record filters (`:274-280`) are typed filter operators, not searches, and stay as they are.

The guard `apps/api/src/__tests__/like-search.guard.test.ts` scans non-test `apps/api/src/**/*.ts` and fails on:
- any call to drizzle's `like` / `ilike` / `notLike` / `notIlike`, which take a raw pattern;
- a `sql` template that interpolates a value right after `LIKE` / `ILIKE` with no `ESCAPE` after it.

Constant patterns written into the SQL (catalog lookups such as `relname LIKE 'pg\_temp\_%'`) carry no user text and aren't flagged. `portal-sql.service.ts` builds plain strings, not `sql` templates, so it needs no allowlist entry. The guard has no allowlist.

The CLAUDE.md project-board section also gains the new `Backlog` status option (`931720e6`). It's a one-line docs change that rides on this PR.

## Plan: 1 slice

**Files**
- Edit `apps/api/src/utils/filter-sql.util.ts` to add `ilikeContains`.
- Edit the 15 files above plus `entity-record.router.ts`, and use `escapeLike` in `portal-sql.service.ts`.
- New `apps/api/src/__tests__/like-search.guard.test.ts`.
- Edit `CLAUDE.md` to add the Backlog option ID.

**Tests** (test first; run `npm run test:unit -- --testPathPattern …` and `npm run test:integration -- --testPathPattern …` from `apps/api`)
- `__tests__/utils/filter-sql.util.test.ts`: `ilikeContains` renders `ILIKE $n ESCAPE '\'` and binds `%50\%%`, `%Q1\_2025%` and `%a\\b%`.
- `__tests__/like-search.guard.test.ts`: the guard self-tests against an inline offending fixture, then passes on the real tree.
- `__integration__/routes/station.router.integration.test.ts`: create `Q1_2025`, `Q1X2025` and `50% off`. Expect:
  - `?search=_` → only `Q1_2025`
  - `?search=%25` → only `50% off`
  - `?search=Q1_2025` → only `Q1_2025`
  - `?search=q1` (case-insensitive) → both Q1 stations
- `__integration__/routes/connector-instance.router.integration.test.ts`: the same `%` / `_` pair on a second, route-level site.
- The `station_list` tool reads through `StationQueryService`, which the station route test above covers. Its agent-side behaviour is smoke step 5.

## Smoke (manual, against your dev stack)

1. On **Stations**, search `%`. Expect "no results" (unless a station name contains `%`).
2. Search `_`. Expect no results. Rename a station to `Q1_2025`, create `Q1X2025`, and search `Q1_2025`: only the first appears.
3. Search `q1` (lower case). Both appear, so case-insensitive matching still works.
4. Repeat steps 1 and 3 on **Connectors**, **Views**, **Tags**, **Groups**, **Column definitions** and **Jobs**. `%` matches nothing; ordinary text still matches.
5. In a portal with the Curated Views pack, ask "Find stations whose name contains %". The `station_list` result shows `total: 0`, and the agent reports that none matched.
6. Clean up the stations you created.

## Out of scope

- Prefix or full-text search semantics. `search` stays a case-insensitive "contains".
- Trigram index coverage for the escaped pattern. `ILIKE '%…%'` with escapes is served by the same `pg_trgm` index.
- The agent's wrong explanation in the #1036 walk. It described the result it got, and with literal matching it gets the right one.
