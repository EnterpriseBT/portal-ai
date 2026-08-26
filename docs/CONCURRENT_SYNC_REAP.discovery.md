# Concurrent sync passes reap each other's records — Discovery

**Issue:** [EnterpriseBT/portal-ai#460](https://github.com/EnterpriseBT/portal-ai/issues/460) · Bug · `full` · epic child of [#444](https://github.com/EnterpriseBT/portal-ai/issues/444)

**Why this exists.** A connector sync can be re-delivered by BullMQ while its first invocation is still running, so two `syncInstance` passes execute concurrently over one entity. Each pass ends by reaping "everything older than my watermark" — so the later pass deletes the earlier pass's still-in-flight writes. Measured on a 397,960-record layer: **34,000 records soft-deleted, job reports `completed`, and the result payload is internally consistent** (`created 34,000 + unchanged 363,960 = 397,960`) because each pass counted its own work correctly.

This is the only defect in the #444 epic that loses data rather than misreporting it. Every other child made the job surface lie; this one makes the *dataset* wrong while the surface looks healthy.

## The current shape

### The reap and its four callers

| Piece | Location | Note |
|---|---|---|
| The reap | `entity-records.repository.ts:297` `softDeleteBeforeWatermark` | `WHERE connector_entity_id = ? AND synced_at < ? AND deleted IS NULL`, returns the reaped ids |
| REST | `rest-api.adapter.ts:499` | passes `runStartedAt`, captured at `syncInstance` entry |
| Google Sheets | `google-sheets.adapter.ts:156` | same, per entity |
| Excel | `microsoft-excel.adapter.ts:159` | same, per entity |
| Layout-plan commit | `layout-plan-draft.service.ts:541` | passes an explicit `watermark` |
| Wide-side cascade | `wide-table.repository.ts` `deleteByEntityRecordIdsBestEffort` | now degrades rather than throwing (#441/#456) |

Every caller stamps each written row with `synced_at = <its own run start>` and then deletes anything below that. The contract is "delete what *this run* did not touch" — and `synced_at < watermark` is a correct encoding of that **only if this run is the only writer**.

### How two passes come to exist

| Piece | Location | Note |
|---|---|---|
| Worker concurrency | `jobs.worker.ts` | `concurrency: 2` — two jobs in one process, and enough slots for a re-delivered copy of the *same* job |
| Retry budget | `jobs.queue.ts:29-30` | `attempts: 3`, exponential backoff — **not** the mechanism here |
| Stall re-delivery | BullMQ | fires when the worker cannot renew its job lock; **does not increment `attemptsMade`** |
| ECS scale | `infra/cloudformation/backend.yml:46` | `DesiredCount: 1` today, so the two passes are in-process — but this is a parameter, not a guarantee |
| Generation key | `rest-api.adapter.ts`, `deriveSourceId` (#439) | `api:<jobId>:<index>` — both passes of one job share it, so they write the **same** `source_id`s |

Observed timeline (job `e70ce606`, entity `dee94e06`):

```
22:40:41  pass A starts                 runStartedAt = 22:40:40.681
22:42:05  pass A at progress 90, enters the reap
          ... ~6.5 min in the reap, lock not renewed ...
22:48:37  pass B starts (re-delivery)   runStartedAt = 22:48:36.717   attempts still 1
22:49:42  pass A, still flushing, writes 34,000 rows stamped 22:40:40.681
22:53:01  pass B's reap deletes everything < 22:48:36.717 — including those 34,000
```

A later clean re-sync (260 s, no broken wide table) did **not** reproduce it: one generation, one watermark, 397,960 live. So the trigger is a **long reap phase**, not the record count — anything that slows the tail (a broken mirror, a large reap set, a loaded box) widens the window.

## The design space

### Decision 1 — can the reap predicate be made safe on its own?

The issue's own fix-direction list put "scope the reap to the generation this run wrote" first. **Working through it, that does not hold, and the correction matters because it is the cheapest-looking option.**

- Both passes belong to one job, so under #439 they share a `generationKey` and write identical `source_id`s. A reap scoped to "my generation" still covers the other pass's rows. No help.
- Give each pass a *distinct* generation and the failure inverts: neither reaps the other, and the entity ends with two full live generations — 795,920 rows where 397,960 belong. Duplication instead of loss.
- Any predicate of the form "rows this pass did not touch" is *correct from that pass's point of view*. Pass B genuinely did not write those 34,000 rows at the moment it looked. The predicate is not wrong; the premise that one pass is the only writer is.

**Lean: no reap predicate fixes this.** The reap is safe if and only if a single pass owns the entity. That reframes the whole ticket from "fix the query" to "establish ownership", and every option below follows from it.

### Decision 2 — how to establish single-writer ownership

| | A — Postgres session advisory lock | B — Redis lease + TTL | C — BullMQ tuning only |
|---|---|---|---|
| Mechanism | `pg_try_advisory_lock(hash(entityId))` on a connection from `connection.reserve()` (postgres.js 3.4.9 has it), held for the run | `SET sync:lease:<entity> NX PX 60000`, renewed on a timer | raise `lockDuration`, soften stall detection |
| Liveness | **Exact** — the lock dies with the TCP session, so "is the other pass alive?" is answered by the database, not guessed | Approximate — a dead pass's lease lingers up to the TTL; a slow pass whose renewal timer is starved loses a lease it still needs | n/a |
| Cross-instance | Yes (shared Postgres) | Yes (shared Redis) | No |
| Cost | Holds 1 of 10 pool connections per running sync (2 max at `concurrency: 2`) | A renewal timer on the sync path | Free |
| Failure mode | Pool pressure if the pool were small or syncs many | Split-brain on a starved renewal — the exact failure being fixed | Reduces the trigger, eliminates nothing |

**Lean: A.** The decisive point is liveness. BullMQ re-delivered *because it guessed wrong* about whether pass A was alive — the lock renewal was starved by a long reap. A TTL lease replaces that guess with the same kind of guess, and would be starved by the same reap. A session lock answers the question structurally: pass A holds a live connection, so pass A is alive, and if its process dies the lock is gone before anything else notices. Same reasoning as the epic's other fixes — prefer a mechanism whose invariant is enforced by the system that owns the state, not by a timeout.

**C is not an alternative but is worth doing alongside** — see Decision 4.

### Decision 3 — what does a pass do when it cannot take the lock?

- **A — abort quietly, report the run as superseded.** Another pass holds a live session, so by construction it is running and will finish the work. ✅ **Lean.** The job must not report `failed` (nothing failed) nor plain `completed` (this pass did nothing) — a distinguishable outcome on the result, e.g. `supersededBy`, matching #441's principle that the payload carries what the status cannot.
- **B — wait for the lock, then run.** Safe but doubles the work and holds a worker slot for the duration; on a 5-minute sync that is a second 5 minutes for no new data.
- **C — throw.** Wrong: it re-introduces exactly the "failed job that did nothing wrong" that #441 removed, and BullMQ would retry it into the same wall.

**Open question:** if the lock holder is alive but genuinely wedged, aborting means nothing progresses until its session drops. Acceptable — a wedged holder is a separate failure needing its own signal, and inventing a takeover protocol here would re-open the liveness guessing this design exists to avoid.

### Decision 4 — also reduce the trigger?

The stall happened because the reap phase ran ~6.5 minutes without the worker renewing its BullMQ lock. Chunking the reap (it already returns every reaped id in one statement — on 431,960 rows) so the event loop yields would shrink the window substantially, and it is cheap.

**Lean: yes, as defence in depth, and explicitly labelled as such.** It must not be mistaken for the fix — a longer-running sync on a loaded box still stalls. Note it also intersects #440's batching work and #436's chunking precedent.

### Decision 5 — should a sync verify its own outcome?

The loss was invisible because the counts were self-consistent. A cheap post-sync assertion — "live rows for this entity should equal what I wrote" — would have caught it.

**Lean: out of scope here, worth its own ticket.** It is a detection mechanism, not a fix, and designing it properly (what to do when it disagrees) is a separate decision. Recorded so the idea is not lost.

## Tradeoff comparison

| | D1: ownership, not predicate | D2: Postgres session lock | D3: abort + report superseded | D4: chunk the reap |
|---|---|---|---|---|
| Fixes the data loss | Frames it | **Yes** | Completes it | No |
| Spread to spec | Yes | Yes | Yes | Yes |
| Cross-instance safe | — | Yes | Yes | n/a |
| Touches all four callers | — | Yes (shared seam) | Yes | Only the reap |

## Recommendation

1. Treat this as an **ownership** problem, not a reap-predicate problem — no `WHERE` clause makes concurrent passes safe.
2. Take a **Postgres session advisory lock keyed by connector entity**, on a reserved connection, for the duration of a sync pass; released when the pass ends or its session dies.
3. Put the lock in **one shared seam** used by all four reap callers, not per-adapter — #436 and #441 both showed that per-caller fixes of this class leave sites armed.
4. A pass that cannot take the lock **aborts without doing work** and reports a distinguishable, non-failed outcome carrying the holder's identity.
5. **Chunk the reap** so the event loop yields, labelled as trigger-reduction rather than the fix.
6. Add a regression test that interleaves two passes over one entity and asserts every source record is still live.

## Enterprise-scale considerations

- **Concurrency & correctness** — the whole ticket. The check-then-act (`write rows` → `reap what I did not write`) is not atomic and has no owner; Decision 2 supplies one. **Lean: session-scoped lock, because its liveness is enforced rather than timed.**
- **Failure modes** — fail-*closed* on the lock: a pass that cannot prove ownership does nothing rather than reaping optimistically. The cost of a skipped pass is a delayed sync; the cost of an optimistic reap is deleted customer data. Asymmetric, so the choice is easy. If the lock *infrastructure* is unavailable (Postgres down), the sync cannot run anyway — no separate fail-open path needed.
- **Multi-tenancy** — the lock is per connector entity, so one tenant's long sync cannot block another's. Locking per instance or globally would be a noisy-neighbour bug.
- **Scale & unbounded growth** — one held pool connection per running sync, bounded by worker `concurrency: 2` against a pool of 10. Must be re-checked if either changes; the spec should state the invariant rather than the numbers.
- **Accuracy & auditability** — a superseded pass should be visible, not silent, or operators will see a sync that "did nothing" with no explanation. Decision 3's result field is the record.
- **Contract stability** — `DesiredCount: 1` today means a purely in-process fix would work *now*. Deliberately not relying on that: the design is cross-instance from the start because scaling the task count must not silently re-introduce data loss.
- **Data lifecycle** — N/A. No windows or retention semantics here; the reaped rows follow #442's existing policy.

## What this doesn't decide

- **Post-sync verification** (Decision 5) — detection, not a fix; its own ticket.
- **Whether `attempts` should count stall re-deliveries.** It stayed `1` across two passes, so the DB still under-records how many times work ran. #441 made `attempts` meaningful for retries; this is a genuine remaining gap, but it is reporting, and this ticket is about loss.
- **BullMQ stall tuning as a product setting** — Decision 4 chunks the reap; changing queue-wide stall parameters affects every job type and deserves its own analysis.
- **Healing already-lost data.** Re-syncing repairs it (a fresh generation replaces the entity), which is how the observed loss was recovered. No migration is proposed.

## Next step

`docs/CONCURRENT_SYNC_REAP.spec.md` pins the lock seam's signature, the reserved-connection lifecycle, the superseded outcome shape, and the reap's chunking. The plan then carves roughly four slices: the lock primitive and its release-on-death behaviour; the shared seam wired through all four callers; the superseded outcome and its reporting; and the reap chunking with the interleaved-passes regression test.
