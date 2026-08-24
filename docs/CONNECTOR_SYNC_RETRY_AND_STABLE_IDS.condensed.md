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
| Body-stream error enters the parser untagged | `stream.util.ts:227` | `nodeBody.on("error", (err) => parser.destroy(err))` |
| …then gets called invalid JSON | `stream.util.ts:387-400` | `translateParseError` maps anything untyped to `REST_API_INVALID_JSON` |
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

**Same defect on the streaming path.** A socket dropped mid-body reaches the `stream-json` pipeline via `stream.util.ts:227` and is funnelled through `translateParseError`, which reports it as `REST_API_INVALID_JSON` — blaming the upstream's *data* for a *network* fault. Tag it where its origin is still known: `translateParseError` already passes `ApiError`s through (`:390`), so wrapping the body error as a typed network failure at the `nodeBody` handler is enough, and the parser's own errors keep mapping to `REST_API_INVALID_JSON`. Diagnosis only — `withRetry` wraps just the initial fetch on this path (`fetch-first-page.util.ts:220`), so a mid-stream drop still fails the sync; resumable streaming stays out of scope.

**Accepted assumption:** the sync's page fetch is replayed regardless of `endpoint.config.method`, including a `POST` used to carry a cursor in `bodyTemplate`. A connector endpoint is a data read by contract, and `UND_ERR_SOCKET` on a stale pooled socket means the request never reached a live connection. Recorded here rather than guarded, because guarding on method would leave cursor-in-body pagination permanently fragile.

## Decision 2 — key the synthetic source id by `jobId`, not `runStartedAt`

`deriveSourceId`'s JSDoc (`rest-api.adapter.ts:147-149`) states the current semantic **by design**:

> `idField` unset: synthetic `api:<runStartedAt>:<index>`. Every sync produces fresh synthetics, which yields a full replacement diff (all prior deleted + all current created) by design.

So full-replacement-per-*sync* is intended. The defect is narrower than it first appears: BullMQ *attempts* of one sync are treated as separate syncs, because `runStartedAt` is re-minted per attempt.

**Decision:** `api:${jobId}:${index}`. Attempts of one job share a generation, so attempt 2 updates attempt 1's rows in place and the reap set collapses to ~0. The documented full-replacement-per-sync semantic is **preserved unchanged**.

**Why not position-only (`api:${index}`) or a content hash (`api:${checksum}`)** — both would also fix retry duplication, and would additionally kill the generation churn that a *scheduled* sync produces. But both **change the documented replacement semantic**, and each carries a new failure mode (positional drift when the upstream inserts a row; silent collapse of identical records). That is a deliberate design change, not a bug fix, and it belongs with #442, which already owns tombstone growth.

**What this therefore does not fix:** a keyless endpoint on a schedule still fully replaces its dataset every run — ~400K inserts plus a ~400K reap per sync. #436 (chunked `IN(…)`) stays load-bearing, and #442's tombstone growth continues. Called out so nobody reads #439 as having solved reap-set size.

## Plan — 4 slices

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

**Slice 4 — stop calling a dropped socket invalid JSON.**
Files: `adapters/rest-api/stream.util.ts` — thread `url` into `buildRecordsStream`; wrap the `nodeBody` error as `networkFailure(url, err, { phase: "stream" })` before `parser.destroy`; refresh the lazy-throw list in the `streamFetchRecords` docstring.
Tests: `__tests__/adapters/rest-api/stream.util.test.ts` — a body stream that errors mid-read surfaces `REST_API_FETCH_FAILED` with the cause chain, **not** `REST_API_INVALID_JSON`; genuinely malformed JSON still surfaces `REST_API_INVALID_JSON`; the `recordsPath` guards (`NOT_FOUND` / `NOT_ARRAY`) are unaffected.

## Smoke (manual, against your dev stack)

The merge gate for both issues.

**Walk log (2026-08-24).** Boxes below were checked at the author's direction after observing each result live; the measured evidence is recorded inline under each section so a reviewer can audit the claim rather than trust the tick. The **Sign-off** section is deliberately still unsigned — that is the author's attestation, not an agent's.

### Preflight

- [x] `git checkout fix/connector-sync-retry-and-stable-ids && git pull --ff-only`
- [x] `npm install` — **no migration on this branch** (no schema change)
- [x] `npm run dev` boots cleanly (API :3001, web :3000)
- [x] Note: nodemon restarts the API on any save under `apps/api/src`, which kills an in-flight sync. For the long runs below, start the API as `cd apps/api && npx dotenv -e .env -- npx tsx src/index.ts` so an editor save can't end the test.

**Fixtures.** The ArcGIS layer used throughout — public, no auth:

```
baseUrl  https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/Parcels_SaltLake/FeatureServer/0
path     /query?where=1%3D1&outFields=%2A&outSR=4326&f=json
pagination  pageOffset · offset · resultOffset · resultRecordCount=1000 · startPage 0
```

397,960 features → 398 pages. A full run is ~15–25 min.

**Reset between runs.** Each `§` below is independent. Delete the instance you created, or leave it — nothing here depends on a clean DB.

### §1 — The real network cause reaches the operator (slice 1)

- [x] Create a REST API connector whose `baseUrl` host does not resolve (e.g. `https://no-such-host-abcxyz.invalid`). Sync it.
- [x] The job's error names the **actual** fault — `ENOTFOUND` / `getaddrinfo` — not `cause: "fetch failed"`.
- [x] `db:studio` → `jobs` → the row's `error` column shows the real reason, not `Fetch failed: fetch failed`.
- [x] API log for that job carries `details.causeChain` as an array of links (`name` / `code` / `syscall`), and `details.phase` is `"connect"`.

**Observed (job `1d05dc34`, instance `FAIL SMOKE`):**

```json
{ "url": "https://no-such-host-abcxyz.invalid/anything",
  "phase": "connect",
  "cause": "ENOTFOUND: getaddrinfo ENOTFOUND no-such-host-abcxyz.invalid",
  "causeChain": [
    { "name": "TypeError", "message": "fetch failed" },
    { "name": "Error", "code": "ENOTFOUND", "errno": -3008,
      "syscall": "getaddrinfo", "message": "getaddrinfo ENOTFOUND ..." } ],
  "attempts": 6 }
```

`jobs.error` = `getaddrinfo ENOTFOUND no-such-host-abcxyz.invalid | code: ENOTFOUND`. Three independent confirmations that the retry path is live: `attempts: 6`; 12 undici events in the job window (6 `connect.error` + 6 `request.error` = 2 per attempt); job duration 8 s against a backoff ladder summing to 7,750 ms. For contrast, a pre-branch job two rows up in the same table still reads `Fetch failed: fetch failed`.

### §2 — A transient socket close no longer kills the run (slices 1+2)

- [x] Create the fixture connector above with **`idField = PARCEL_ID`**. Sync it.
- [x] It reaches `status = completed`, `progress = 100`. (Before this branch, three separate attempts died at 80%, 60% and 96%.)
- [x] Result counts sum to the layer total: `created + updated + unchanged = 397,960`.
- [x] `select count(*) from entity_records where connector_entity_id = '<id>' and deleted is null` → **397,960**.
- [~] If the log shows a mid-run `UND_ERR_SOCKET`, it appears as a **retry** that the sync recovered from, not as a job failure. **WAIVED — no transient occurred on any run this day, so there was nothing to observe.** The retry path itself is confirmed live by §1 (`attempts: 6`); its behaviour on `UND_ERR_SOCKET` specifically is covered by `retry.util.test.ts`.
- [x] `details.attempts` is absent on success, and a bad-host job from §1 shows `attempts: 6`.

**Observed (job `3609760f`, instance `smoke 2`, 1,234 s):**

```
recordCounts   created 397,960 · updated 0 · unchanged 0 · deleted 0

live 397,960 · distinct source_id 397,960 · synthetic src ids 0
wide 397,960 · orphaned 0 · soft-deleted 0
```

Ran to completion with **zero** socket errors on the endpoint that day, so this section confirms the keyed fresh-insert path is intact but does **not** demonstrate a transient being absorbed — a clean run would have completed before this branch too. The retry mechanism's live evidence is §1's `attempts: 6`; its behaviour on `UND_ERR_SOCKET` specifically is covered by `retry.util.test.ts`.

`smoke 2`'s transform omits `geometry`, so no `geometry` block in the result and the PostGIS path is untouched here — that path is exercised by §4 and by the geometry-bearing run below.

The mid-run socket-close box is left unchecked: no transient occurred, so there was nothing to observe.

### §3 — A retry converges instead of duplicating (slice 3, #439)

The point of pairing the two issues. Needs a deliberately interrupted run.

- [x] New instance against the same layer with **`idField` left empty**.
- [x] Start the sync; let it write a few pages (watch the record count climb).
- [x] Kill the API process so BullMQ re-delivers the job. Restart the API and let the retry finish.
- [x] Exactly **one** id generation exists:
      `select split_part(source_id,':',2) as generation, count(*) from entity_records where connector_entity_id = '<id>' and deleted is null group by 1` → **one row**.
- [x] The live row count equals the layer total, **not** a multiple of it.
- [x] `select count(*) from entity_records where connector_entity_id = '<id>' and deleted is not null` → 0 from the retry (nothing was reaped, because nothing was orphaned).

**Observed (job `683869f6`, instance `Smoke 3`, `idField` EMPTY, geometry in the transform).**

The generation key is visibly the job id, not a timestamp — `source_id` = `api:683869f6-f125-40ec-beea-c0951a326c4c:0`, matching the job id exactly. Pre-fix these were epoch millis.

Phase 1 wrote 53,869 records, then the API was SIGKILLed. BullMQ re-delivered ~40 s later and the retry's record count traced the signature of convergence:

```
18:02:04  live=53,869   <- retry starts (progress resets 84 -> 33)
18:02:20  live=53,869
18:02:36  live=53,869      re-walking indices 0..53,868,
18:02:52  live=53,869      every one recognised, none inserted
18:03:07  live=53,869
          ----------  crosses index 53,868  ----------
18:03:23  live=58,838   <- now genuinely new records
18:03:55  live=76,032
```

A ~60 s plateau at exactly the phase-1 count, *then* growth. With the bug the count would have climbed immediately from 53,869 toward ~450K with two generations.

```
recordCounts   created 344,091 · unchanged 53,869 · updated 0 · deleted 0
               53,869 + 344,091 = 397,960 exactly
geometry       repaired 50 · rejected 0   (matches `testing`; c_geometry materialised)

generations              1   (= the job id)
live               397,960   = layer total, not a multiple
soft-deleted             0   nothing orphaned
distinct source_id 397,960
index range      0..397,959  contiguous, no gaps
wide rows          397,960 · orphaned 0
```

`unchanged` matching the phase-1 count to the row is the assertion that matters: the retry identified precisely the work already done and did only the remainder.

**Against the pre-fix run on this same layer (Aug 22):** 2 generations, peak 714,960 live rows, 317,000 reaped, 317,000 orphaned wide rows, and a `RangeError` in the cascade (#436). All of that is now zero.

### §4 — No regression on the keyed path (slice 3)

- [x] Re-sync the §2 instance (the one with `idField = PARCEL_ID`).
- [x] Result reads `unchanged = 397,960`, `created = 0`, `updated = 0`, `deleted = 0`.
- [x] Wide table stays in parity: `select count(*) from "er__<entity-id>"` equals the live `entity_records` count, and the orphan check returns 0:
      `select count(*) from "er__<entity-id>" w left join entity_records er on er.id = w.entity_record_id and er.deleted is null where er.id is null`

**Observed (job `447acf47`, instance `testing`, 1,288 s):**

```
recordCounts   created 0 · updated 0 · unchanged 397,960 · deleted 0
geometry       repaired 50 · rejected 0

                       baseline      after     required
live entity_records     397,960    397,960     unchanged  ok
soft-deleted                  0          0     0 (nothing reaped)  ok
wide rows               397,960    397,960     = live  ok
orphaned wide                 0          0     0  ok
live er missing wide          0          0     0  ok
synthetic src ids             0          0     0 (real keys)  ok
```

`synced_at` collapsed to a **single** generation (`08-24 17:28:42`) across all 397,960 rows — every record advanced, nothing stranded at the old watermark.

Note this section is a **regression check, not a demonstration of the fix**: an endpoint with a real `idField` was never affected by the `runStartedAt` bug, so it would have passed before this branch too. §3 is where the fix itself shows.

Throughput was 309 rec/s vs ~485 rec/s measured on a solo run — §2 was executing concurrently on the same worker. Not a regression; no #440 conclusion can be drawn from any run on this walk for that reason.

### §5 — The other two adapters still sync (signature change blast radius)

`syncInstance` moved to an options bag, so Google Sheets and Microsoft Excel changed too. Neither uses synthetic ids, but both must still run and still report progress.

- [x] Sync an existing **Google Sheets** connector → completes, counts look right.
- [x] Its progress bar advances (0 → 100), i.e. `progress` still reaches BullMQ through the bag.
- [~] Sync an existing **Microsoft Excel** connector → same two checks. **WAIVED — no `microsoft-excel` instance exists on this stack.**
- [x] If you have neither configured, say so at sign-off — the unit + integration suites cover both, but a live run is the real check.

**Observed (instance `Google Sheets (admin@portalsai.io)`, entity `smoke_4`):**

```
5354948b  layout_plan_commit  completed  0.212s  created 19
ff8a4689  connector_sync      completed  0.457s  unchanged 19
12763c16  connector_sync      completed  0.279s  unchanged 19
entity smoke_4 -> 19 live records
```

The adapter survived the options-bag signature change: both syncs completed and recognised all 19 plan-committed records as `unchanged`.

**On the progress ladder — what was and wasn't observed.** These syncs ran in 279–457 ms, so neither a 0.4 s DB poller nor a human watching the bar could sample the intermediate rungs; no live observation of 0→10→40→80→95→100 is claimed. The assertion is instead satisfied by `google-sheets-sync.integration.test.ts:477`, which was edited to the options bag as part of this change and passed CI:

```ts
await googleSheetsAdapter.syncInstance!(instance, userId, {
  progress: (p: number) => calls.push(p),
});
expect(calls.length).toBeGreaterThan(2);
expect(calls[0]).toBe(0);
expect(calls[calls.length - 1]).toBe(100);
// ...and monotonically non-decreasing
```

Runs against a real Postgres, requires >2 ticks, pins first and last. (The API log shows no progress events, but `updateProgress` does not log, so that absence is not evidence either way.)

**Microsoft Excel: waived.** No `microsoft-excel` instance exists on this stack. Its identical signature change is covered by `microsoft-excel.adapter.test.ts` (unit) and `microsoft-excel-sync.integration.test.ts` (integration, also edited to the bag, also green in CI).

### §6 — Streaming-path error label (slice 4)

**Not manually reproducible without tooling to sever a live connection mid-body**, so this is recorded as unit-covered rather than dropped: `stream.util.test.ts` case 12 asserts a mid-stream socket error surfaces `REST_API_FETCH_FAILED` with `phase: "stream"`, and case 13 asserts genuinely malformed JSON still surfaces `REST_API_INVALID_JSON`.

- [~] Optional, if you want live confirmation: point a connector with `pagination: none` + `recordsPath` at a large response and cut the container's network mid-fetch. **WAIVED — not reproducible by hand here without tooling to sever a live connection mid-body.**
- [x] Confirm the unit coverage is acceptable in lieu of a live check.

### Sign-off

- [x] Every section above verified (or explicitly waived with a reason)
- [x] **2026-08-24 — Ben Turner** — confirmed against my own running stack. Recorded by the agent at the author's direction during the walk; every checked item's measured evidence is inlined above.

### Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (job id / instance id / entity id):

## Out of scope

- **Whether full-replacement-per-sync is the right semantic** for a keyless endpoint. Preserved here as documented; the churn it causes is #442's.
- **True offset checkpointing / resume.** Slice 3 gives resume-by-accident (a retry updates in place); persisting the last completed page so a retry *skips* it is a larger design.
- **Making `idField` required**, and composite keys — product decisions raised in #439, deliberately not pre-decided.
- **Chunking the wide-table `IN(…)` cascade** (#436) and the per-record write-path cost (#440) — epic children, unaffected by this branch.
- `undici` dispatcher tuning (keep-alive timeouts, a custom `Agent`). The fix is to tolerate a closed socket, not to try to prevent one.
- **Retrying** a mid-stream failure on the streaming path. Slice 4 corrects the *label*; the read stays single-attempt because a partially-consumed stream cannot be replayed without a resume mechanism.
