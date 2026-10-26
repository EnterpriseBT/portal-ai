# Job stream misses a fast job's finish — Condensed design (#886)

**Issue:** [EnterpriseBT/portal-ai#886](https://github.com/EnterpriseBT/portal-ai/issues/886) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `GET /api/sse/jobs/:id/events` read the job, checked access, sent a snapshot, and only then subscribed to Redis pub/sub. A job that reached its terminal state in between published its final update to nobody. The client held a non-terminal snapshot and waited forever. A small upload's parse (20–90ms) hit it 2 times in 5: "Parsing spreadsheet… 90%" with the job `completed`. Package: `apps/api`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Stream route | `apps/api/src/routes/job-events.router.ts` | `findById` → access check (`PermissionService.loadSet` ×2) → snapshot → `JobEventsService.subscribe` |
| Subscribe | `apps/api/src/services/job-events.service.ts` (`subscribe`) | fires `SUBSCRIBE` without awaiting its acknowledgement |
| Publish order | `JobEventsService.transition` | persists to Postgres, **then** publishes |
| Other consumer | `apps/api/src/utils/await-job-terminal.util.ts` | already backstops with a row poll; unchanged |

## Decision — subscribe, acknowledge, then read

The options were a client-side poll fallback (it hides the server gap and every consumer would need it), or ordering the route correctly. **Chosen: ordering.**
- `JobEventsService.subscribeReady` resolves once Redis has acknowledged the subscription, a second listener on a channel included. `subscribe` stays for `awaitJobTerminal`.
- The route authorizes as before, then awaits `subscribeReady`, **re-reads** the job and snapshots that. It closes if the job is terminal, and otherwise flushes the events held during the read that are terminal or newer than the row's `updated`.
- Because `transition` persists before it publishes, a read after the acknowledgement can't miss a transition: it's either in the read or arrives as an event.

## Plan — 1 slice

**Files:** `apps/api/src/services/job-events.service.ts` (`subscribeReady`, per-channel acknowledgement), `apps/api/src/routes/job-events.router.ts` (the order above).

**Tests** (`cd apps/api && npm run test:integration -- --testPathPattern "(routes/jobs.router|services/job-events.service)"`):
- `jobs.router.integration.test.ts`. The job finishes inside the window, from the access check (a `PermissionService.loadSet` spy that runs `JobEventsService.transition`). The stream still ends with `completed`. Before the fix it never closed (timeout).
- `job-events.service.integration.test.ts`. A publish straight after `subscribeReady` resolves reaches both of two concurrent listeners.

## Smoke (manual, against your dev stack)

1. Upload a small CSV through Connectors → Catalog → File Upload ten times. Each one advances to "Draw regions", and none sits at "Parsing spreadsheet… 90%".
2. A long job (a large file, or a sync) still streams progress to completion.

## Out of scope

- #887 (a failed commit lands on "Connector instance not found").
- The SSE token in the query string (pre-existing design).
