# Connector sync: transient retry + stable synthetic source ids — Condensed design (#435, #439)

**Issues:** [#435](https://github.com/EnterpriseBT/portal-ai/issues/435) · [#439](https://github.com/EnterpriseBT/portal-ai/issues/439) — both `Bug`, both **small / condensed** (discovery + spec + plan + smoke in one doc). One branch, one PR, closing both.

**Why.** A paginated REST API sync of a ~400K-record endpoint cannot finish: one ordinary transient socket close kills the whole run, unretried. Fixing that alone is unsafe, because it un-masks #439 — today the run dies before a retry gets far, so the fact that each *attempt* mints a fresh generation of synthetic source ids never bites. Fix the retry and retries start happening; a keyless endpoint then inserts a full second copy per attempt (measured: 714,960 live rows for a 397,960-feature source, which then overflowed the stack in #436). The two ship together. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `fetch()` wrapped → typed error | `adapters/rest-api/fetch.util.ts:51-59` | catches, throws `REST_API_FETCH_FAILED` with `{url, cause}` |
| `cause` stored as the *message* | `fetch.util.ts:57-58` | `cause: (err as Error).message` — records `"fetch failed"`, discards `err.cause` |
| **Body read NOT wrapped** | `fetch.util.ts:95` → `readBodyWithCap:140-176` | `await reader.read()` rejects raw; escapes as `TypeError: terminated` |
| Same discard, streaming path | `adapters/rest-api/stream.util.ts:96-104` | identical `cause:` bug |
| Non-`ApiError` → immediate throw | `adapters/rest-api/retry.util.ts:57` | kills the body-read failure before the status gate |
| Statusless → immediate throw | `retry.util.ts:61-64` | `status === undefined` ⇒ no retry; budget only ever serves 429/502/503/504 |
| Retry policy | `retry.util.ts:34-39` | `maxRetries: 5`, exp backoff 250ms→8s |
| `deriveSourceId` | `adapters/rest-api/rest-api.adapter.ts:144-162` | `api:${runStartedAt}:${index}` when `idField` unset |
| Its only caller | `rest-api.adapter.ts:584` | inside `upsertRecord` |
| `syncInstance` signature | `adapters/adapter.interface.ts:173-177` | `(instance, userId, progress?)` — **no `jobId`** |
| Sole invocation site | `queues/processors/connector-sync.processor.ts:49` | `jobId` already in `bullJob.data`; other refs are existence checks only (`sync.service.ts:131`, `wide-table-resync.service.ts:71`) |
| Other implementors | `google-sheets.adapter.ts:85`, `microsoft-excel.adapter.ts:88` | signature-only update; neither uses synthetic ids |

## Decision 1 — retry every statusless network failure, and stop losing the cause

Two code paths produce the same physical failure and neither retries: a rejected `fetch()` (an `ApiError` with no `status`, killed at `retry.util.ts:61`) and a rejected body read (a bare `TypeError`, killed at `retry.util.ts:57`).

**Decision:** wrap the body read so *both* surface as `REST_API_FETCH_FAILED` carrying `url` and a walked `cause` chain, then treat a statusless `REST_API_FETCH_FAILED` as retryable under the existing backoff. No new policy knob, no per-class allowlist.

**Why not classify by cause code** (retry `UND_ERR_SOCKET`, not `ENOTFOUND`): all three observed failures were `UND_ERR_SOCKET: other side closed`, and a wrong classification fails closed in the worst way — an unretried transient. A genuinely permanent fault (bad host) simply exhausts the 5-attempt budget in <10s of backoff and reports the same error it does today, now with the real cause attached.

**Accepted assumption:** the sync's page fetch is replayed regardless of `endpoint.config.method`, including a `POST` used to carry a cursor in `bodyTemplate`. A connector endpoint is a data read by contract, and `UND_ERR_SOCKET` on a stale pooled socket means the request never reached a live connection. Recorded here rather than guarded, because guarding on method would leave cursor-in-body pagination permanently fragile.

## Decision 2 — key the synthetic source id by `jobId`, not `runStartedAt`

`deriveSourceId`'s JSDoc (`rest-api.adapter.ts:147-149`) states the current semantic **by design**:

> `idField` unset: synthetic `api:<runStartedAt>:<index>`. Every sync produces fresh synthetics, which yields a full replacement diff (all prior deleted + all current created) by design.

So full-replacement-per-*sync* is intended. The defect is narrower than it first appears: BullMQ *attempts* of one sync are treated as separate syncs, because `runStartedAt` is re-minted per attempt.

**Decision:** `api:${jobId}:${index}`. Attempts of one job share a generation, so attempt 2 updates attempt 1's rows in place and the reap set collapses to ~0. The documented full-replacement-per-sync semantic is **preserved unchanged**.

**Why not position-only (`api:${index}`) or a content hash (`api:${checksum}`)** — both would also fix retry duplication, and would additionally kill the generation churn that a *scheduled* sync produces. But both **change the documented replacement semantic**, and each carries a new failure mode (positional drift when the upstream inserts a row; silent collapse of identical records). That is a deliberate design change, not a bug fix, and it belongs with #442, which already owns tombstone growth.

**What this therefore does not fix:** a keyless endpoint on a schedule still fully replaces its dataset every run — ~400K inserts plus a ~400K reap per sync. #436 (chunked `IN(…)`) stays load-bearing, and #442's tombstone growth continues. Called out so nobody reads #439 as having solved reap-set size.

## Plan — 3 slices

**Slice 1 — preserve the cause chain; wrap the body read.**
Files: `adapters/rest-api/fetch.util.ts` (new `describeCause()` walking `err.cause` to depth ~8 collecting `{name, code, errno, syscall, message}`; use it in the `fetch()` catch; wrap `readBodyWithCap` in try/catch throwing `REST_API_FETCH_FAILED` with `url` + chain), `adapters/rest-api/stream.util.ts` (same helper in its `fetch()` catch).
Tests: `__tests__/adapters/rest-api/fetch.util.test.ts` — a `fetchImpl` rejecting with a nested-`cause` `TypeError` yields `details.cause` as the chain; a `response.body` whose reader rejects mid-read yields `REST_API_FETCH_FAILED` (not a raw `TypeError`) carrying `url`.

**Slice 2 — retry statusless network failures.**
Files: `adapters/rest-api/retry.util.ts` — before the status gate, treat `err.code === REST_API_FETCH_FAILED && details.status === undefined` as retryable; on budget exhaustion rethrow with `details.attempts` as it does today.
Tests: `__tests__/adapters/rest-api/retry.util.test.ts` — a statusless `REST_API_FETCH_FAILED` retries and succeeds on attempt 3; exhausting the budget rethrows with `attempts: 6`; a non-`ApiError` still throws immediately (unchanged); a 400 still throws immediately (unchanged).

**Slice 3 — thread `jobId`; key synthetic ids by it.**

Signature became an **options bag**, not a 4th positional param: `syncInstance(instance, userId, opts?: SyncInstanceOptions)` with `{ progress?, jobId? }`. Rationale — ~40 test call sites pass `(instance, userId)` and stay valid, while only 4 passed `progress` positionally and needed touching; a bag also absorbs the next added field without re-churning every adapter.

`jobId` is **optional with a `runStartedAt` fallback** rather than required. Making it required would have broken all ~40 sites for no safety gain, and the real risk — production silently losing it — is covered where it belongs, by a processor test. Direct/unit invocations keep exactly the pre-#439 behaviour.

`runStartedAt` stays per-attempt: it is the reap watermark and *must* only spare rows the current attempt touched. Only the identity generation moves to the job.

Files: `adapters/adapter.interface.ts` (new `SyncInstanceOptions`; `syncInstance` takes the bag), `queues/processors/connector-sync.processor.ts:49` (pass `{ progress, jobId }`), `adapters/rest-api/rest-api.adapter.ts` (`syncInstance` derives `generationKey = opts?.jobId ?? String(runStartedAt)` → `syncOneEndpoint` → `UpsertContext.generationKey` → `deriveSourceId`, whose 3rd param becomes `generationKey: string`), `adapters/google-sheets/google-sheets.adapter.ts:85` + `adapters/microsoft-excel/microsoft-excel.adapter.ts:88` (bag + `const progress = opts?.progress`).
Tests: `__tests__/adapters/rest-api/rest-api.adapter.test.ts` — same id for the same `(generationKey, index)` regardless of wall clock; different generations stay distinct; indexes stay distinct within a generation; existing `idField` precedence + empty-value fallback cases retargeted to string keys. New `__tests__/queues/processors/connector-sync.processor.test.ts` — the processor passes `jobId`, still forwards `progress`, and passes instance/userId unchanged. This is the guard that stops the fallback quietly becoming the production path.

All three: `npm run test:unit` (apps/api), `npm run type-check`, `npm run lint`.

## Smoke (manual, against your dev stack)

1. **Cause chain is visible.** Create a REST API connector whose `baseUrl` host does not resolve. Sync it. → The job error carries the real reason (`ENOTFOUND` / `getaddrinfo`), not `cause: "fetch failed"`, and `details.attempts` shows the budget was spent.
2. **A transient close no longer kills the run.** Sync the 397,960-feature layer (`services1.arcgis.com/.../Parcels_SaltLake/FeatureServer/0`, `resultOffset`/`resultRecordCount=1000`) with `idField = PARCEL_ID`. → It completes: `created + updated + unchanged = 397,960`, `status = completed`. Any mid-run socket close appears in the logs as a retry, not a failure.
3. **A retry no longer duplicates.** New instance against the same layer with `idField` **left empty**. Start the sync, let it write a few pages, then stop the API process so BullMQ re-delivers it. → After the retry completes, `select split_part(source_id,':',2), count(*) from entity_records where connector_entity_id = '<id>' and deleted is null group by 1` returns **exactly one** generation, and the live row count equals the layer count — not a multiple of it.
4. **No regression on the keyed path.** Re-sync the instance from step 2. → `unchanged = 397,960`, `created = updated = deleted = 0`, and `select count(*) from "er__<entity-id>"` still equals the live `entity_records` count with zero orphans.

## Out of scope

- **Whether full-replacement-per-sync is the right semantic** for a keyless endpoint. Preserved here as documented; the churn it causes is #442's.
- **True offset checkpointing / resume.** Slice 3 gives resume-by-accident (a retry updates in place); persisting the last completed page so a retry *skips* it is a larger design.
- **Making `idField` required**, and composite keys — product decisions raised in #439, deliberately not pre-decided.
- **Chunking the wide-table `IN(…)` cascade** (#436) and the per-record write-path cost (#440) — epic children, unaffected by this branch.
- `undici` dispatcher tuning (keep-alive timeouts, a custom `Agent`). The fix is to tolerate a closed socket, not to try to prevent one.
