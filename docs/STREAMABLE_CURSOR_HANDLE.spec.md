# Streamable cursor-backed handle — Spec

**After this lands, a query handle can stream its *full* result past `HANDLE_ROW_CAP` (100k), not just page a ≤100k Redis snapshot.** The ≤100k snapshot stays the hot random-access tier (`getSnapshot`, unchanged); a new forward-only `streamHandle` pages the snapshot then, beyond it, **re-executes the retained query with keyset pagination** (decision A). A new `resolveRecordStream` exposes that stream to the `streaming` consumption mode, and the three single-pass reduce tools (`forecast`, `technical_indicator`, `portfolio_metrics`) fold over it — exact at any N, one batch resident at a time. This is the shared in-process dataset-scaling substrate; #124 (remote pull-on-read), #92 (pin replay), and `bulk_transform`'s worker read are later consumers of the *same* cursor.

Discovery: `docs/STREAMABLE_CURSOR_HANDLE.discovery.md`. Issue: [#129](https://github.com/EnterpriseBT/portal-ai/issues/129). Builds on #121 (`resolveRecordSource`, the `consumption` contract).

## Key decisions (flag for review)

1. **Re-execute + keyset (D1, confirmed).** The handle retains its `sql` + a stable sort key; reads past the 100k snapshot re-run `… WHERE <key> > :last ORDER BY <key> LIMIT :n`. Stateless — survives the 24h TTL + multi-process, no held connections, no disk staging. Non-snapshot-consistent across pages *by design* (this is the freshness #92's live pins want); strict point-in-time consistency is out of scope (#92's deferred compliance mode).

2. **The stable sort key (surfaced while speccing — flag).** Keyset over a *re-executed* query requires a **deterministic, unique total order** reproducible across re-executions — otherwise pages skip/duplicate. Resolution:
   - **Entity-record source (the common case):** key on the source's stable unique id (`source_id` / the `er__` row id). A forecast over an entity's time series keys on id (or a unique timestamp). This covers the realistic cursor workload.
   - **Arbitrary SQL with no resolvable unique order (joins, group-bys, no unique projection):** the cursor is **not available**; the tool falls back to the **≤100k bounded tier** (`resolveRecordSource` + `onOverflow`). The cursor is *best-effort, available when a stable key resolves* — it never silently keyset-pages an unstable order.
   - Resolution lives in a `resolveSortKey(sql, stationData)` helper; **a spike (plan S2) validates keyset stability over re-execution for the entity-source case before the read path is built.**

3. **Two tiers + a separate forward-only API (D2, confirmed).** `getSnapshot(handle,{offset,limit})` unchanged (random-access, ≤100k, ≤5k/call). New `streamHandle(handle): AsyncIterable<Batch>` — forward-only; yields Redis snapshot batches up to 100k, then keyset re-execution batches beyond. Envelope gains `sql`, the resolved `sortKey`, and `cursor: boolean` (true iff a sort key resolved and `rowCount > HANDLE_ROW_CAP`).

4. **`resolveRecordStream` + three folds (D3, confirmed).** New `resolveRecordStream(input, consumption): AsyncIterable<ComputeRecord[]>` is the `streaming` branch (parallel to `resolveRecordSource` for inline/`bounded`). `forecast`/`technical_indicator`/`portfolio_metrics` fold over batches (online accumulator forms of their `AnalyticsService` methods). `bounded` tools (`cluster`/`logistic_regression`) are unchanged — their streaming variants are #130/E2.

5. **Cap semantics (D4, confirmed).** 100k is the *in-memory materialization* threshold, not a processing ceiling; `COMPUTE_INPUT_TOO_LARGE` is demoted to the `bounded` + `onOverflow:error` outcome only. No new global cap: the query bounds N, keyset keeps one batch resident, a per-page `statement_timeout` (`STATEMENT_TIMEOUT_MS`) bounds a runaway page. **Follow-up (F):** a very-large *synchronous* streaming reduce blocks the agent turn; total-work job-escalation is F's machinery, noted not built.

## The envelope + read contract

`QueryHandleEnvelope` (`portal-sql-handle.service.ts:30`) gains:
```ts
sql: string;                 // retained for re-execution (was discarded)
sortKey: string | null;      // resolved deterministic keyset column; null → no cursor
cursor: boolean;             // true iff sortKey != null && rowCount > HANDLE_ROW_CAP
```
`produce` retains `sql`, calls `resolveSortKey`, sets `cursor`. (`sql` lives in Redis under the handle's existing 24h TTL + scoping — it's the agent's own query, no new secret.)

`streamHandle(handleId): AsyncIterable<ComputeRecord[]>`:
1. Page the Redis snapshot in batches (existing `getSnapshot` machinery) up to `min(rowCount, HANDLE_ROW_CAP)`.
2. If `cursor`, continue past 100k by re-executing `SELECT … FROM (<sql>) t WHERE <sortKey> > :last ORDER BY <sortKey> ASC LIMIT :pageSize`, advancing `:last` to the last row's key each page, until a short page. Each page runs under `SET LOCAL statement_timeout = STATEMENT_TIMEOUT_MS`.
3. `null` sortKey ⇒ no step 2; the stream ends at the snapshot (the `bounded` tier owns >100k for un-keyable queries).

## Surface

| File | Change |
|---|---|
| `packages/core/src/contracts/portal-sql.contract.ts` | envelope schema += `sql`, `sortKey`, `cursor` |
| `apps/api/src/services/portal-sql-handle.service.ts` | `produce` retains `sql` + `resolveSortKey` + `cursor`; new `streamHandle` (snapshot batches → keyset re-execution) |
| `apps/api/src/services/portal-sql-handle.service.ts` (or a util) | `resolveSortKey(sql, stationData)` — entity-id case + null fallback |
| `apps/api/src/tools/record-source.ts` | new `resolveRecordStream(input, consumption)`; `streaming` branch delegates to `streamHandle` |
| `apps/api/src/services/analytics.service.ts` | online/fold forms for `forecast` / `technical_indicator` / `portfolio_metrics` |
| `apps/api/src/tools/{forecast,technical-indicator,portfolio-metrics}.tool.ts` | consume `resolveRecordStream` + fold |
| `packages/core/src/constants/large-data-ops.constants.ts` | doc the 100k as materialization-threshold (no value change) |

## Tests

**Unit**
1. `resolveSortKey` — entity-source SQL → the id column; arbitrary/un-keyable SQL → `null`.
2. `streamHandle` — ≤100k handle yields exactly the snapshot batches, no re-execution (mock the engine; assert no keyset query).
3. `streamHandle` — `cursor` handle yields snapshot batches then keyset pages; advances `:last`; terminates on a short page (mock engine returns ordered pages).
4. `streamHandle` — `sortKey: null` ends at the snapshot (no step 2).
5. `resolveRecordStream` — `streaming` consumption yields batches; small inline/handle still works (ceiling-not-mandate).
6. The three folds — given a fixture stream, the online form equals the current whole-array result (`forecast` MAPE/forecast values; EMA series; cumulative metrics).

**Integration**
7. Real `er__` source > 100k rows → `streamHandle` streams every row once, in keyset order, one batch resident (assert peak rows held ≈ pageSize, total = rowCount); a `forecast` over it equals the hand-computed forward fit.
8. Keyset stability (the S2 spike, promoted to a test): re-execution across pages over a stable-id source returns each row exactly once (no skips/dups) — including with concurrent inserts to the source (the new rows appear at the tail or not at all, never duplicate an emitted key).

## Acceptance criteria

- [ ] Envelope carries `sql`/`sortKey`/`cursor`; `produce` retains + resolves them.
- [ ] `streamHandle` streams ≤100k from the snapshot and >100k via keyset re-execution; `null` sortKey stops at the snapshot.
- [ ] `resolveRecordStream` feeds the `streaming` mode; `resolveRecordSource` (bounded/inline) unchanged.
- [ ] The three reduces fold over the stream; results match the whole-array forms (test 6).
- [ ] `COMPUTE_INPUT_TOO_LARGE` only fires for `bounded` + `onOverflow:error` (a `streaming` tool over >100k keyed source succeeds).
- [ ] Integration tests 7–8 green; one batch resident; keyset exact.
- [ ] `npm run test:unit` + `test:integration` + `lint` + `type-check` green.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| **Keyset instability over re-execution** (no deterministic order → skip/dup) — *the headline risk of A* | The S2 spike + test 8 gate it; cursor is **best-effort, gated on a resolvable stable key**; un-keyable SQL falls back to the bounded tier, never silently mis-pages. |
| Non-snapshot-consistency (rows change mid-stream) | By design (matches #92 freshness); a mid-stream insert appears at the tail or not, never duplicates an emitted key (test 8). |
| Long synchronous fold blocks the turn | Realistic-N for series folds is use-case-bounded; total-work job-escalation noted as an F follow-up. |
| Re-execution cost vs the snapshot | The ≤100k hot tier is unchanged; re-execution only for the >100k tail, keyset (O(page) not O(offset)), per-page timeout. |

**Rollback:** revert the merge. The envelope fields are additive; `streamHandle`/`resolveRecordStream` are new and unreferenced after revert; the three tools fall back to `resolveComputeRecords` (bounded). No schema/migration.

## Out of scope

- **Streaming variants of `bounded` tools** (mini-batch k-means / SGD) — #130/E2.
- **Total-work job-escalation** for huge synchronous folds — F.
- **Remote (webhook) consumption** (#124) and **pin replay** (#92) — consumers built on this.
- **`bulk_transform` re-homing its source read onto the cursor** — F Part A (#131).
- **Large raw-series *output*** (a >100k fitted series as rows) — aggregate-before-render for display; a raw-series output handle overlaps #124's `produceFromRows`.

## Cross-references

- `docs/STREAMABLE_CURSOR_HANDLE.discovery.md` — D1–D4, the #92-resolved consistency question.
- `apps/api/src/services/portal-sql-handle.service.ts` — `produce` / `getSnapshot` (the snapshot tier this extends).
- `apps/api/src/tools/record-source.ts` — `resolveRecordSource` (#121/C; `resolveRecordStream` is its `streaming` sibling).
- #92 (pin replay), #124 (remote adapter), #131 F Part A (`bulk_transform`) — downstream consumers.
