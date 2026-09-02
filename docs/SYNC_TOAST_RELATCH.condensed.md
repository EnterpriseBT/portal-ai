# Sync toast re-latch after reload — Condensed design (#493)

**Issue:** [EnterpriseBT/portal-ai#493](https://github.com/EnterpriseBT/portal-ai/issues/493) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Reloading (or first visiting) a connector-instance page while a sync is running shows no progress toast — `useConnectorInstanceSync` holds `jobId` in component state, seeded only by the sync mutation's response or the 409 `SYNC_ALREADY_RUNNING` latch, so a reload loses it and nothing re-subscribes. The backend already exposes everything needed (SSE snapshot + persisted `progress_detail`, #458). Single package: `apps/web`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `jobId` component state, mutation/409-seeded only | `apps/web/src/utils/use-connector-instance-sync.util.ts:73-115` | Lost on reload; nothing queries for an in-flight sync |
| Running-jobs query, already on this view | `apps/web/src/api/connector-instances.api.ts:134-145` (`sdk.connectorInstances.runningJobs`) | GET `/running-jobs` — non-terminal jobs locking the instance; drives the lock chip |
| Same query consumed by the view | `apps/web/src/views/ConnectorInstance.view.tsx:131-139` | React Query dedupes by key — a second subscriber costs no extra request |
| Job summary shape | `packages/core/src/contracts/connector-instance.contract.ts:194-201` | `{ id, type, status, startedAt, created }` — `type` lets us pick `connector_sync` |
| SSE stream + toast | `use-connector-instance-sync.util.ts:77` → `ConnectorInstanceSyncFeedback.component.tsx` | Snapshot carries `progressDetail`; works for any jobId once seeded |

## Decision — where the re-latch lives

**A (chosen): seed inside the hook from `sdk.connectorInstances.runningJobs`.** The hook subscribes to the same query the view already runs (deduped by React Query), and when `jobId` is null seeds it from the first `runningJobs` entry with `type === "connector_sync"`. Self-contained: the hook stays the single owner of sync state, no signature change, covers reload *and* first-visit-during-sync.

**B: thread `runningJobs` in from the view as an argument.** Same data, but changes the hook signature, splits ownership of the latch across two files, and every future caller must remember to wire it.

**C: query `sdk.jobs.list({type, status})` and filter by `metadata.connectorInstanceId` client-side.** Works, but duplicates a purpose-built endpoint that is already on the page.

Chosen: **A**. One guard: seed **once per mount** (a `useRef` flag) — after the user dismisses a finished toast, a stale not-yet-refetched `runningJobs` result must not re-open it. The single-flight 409 guarantees at most one running sync per instance, so "first matching entry" is unambiguous.

## Plan — 1 slice

**Files**
- Edit: `apps/web/src/utils/use-connector-instance-sync.util.ts` — subscribe to `sdk.connectorInstances.runningJobs(connectorInstanceId)`; `useEffect` seeds `setJobId(job.id)` when `jobId === null`, the seed ref is unset, and a `connector_sync` entry exists; set the ref on seed (and on mutation/409 seeds, so a later dismissal never re-seeds from stale data).
- New: `apps/web/src/__tests__/use-connector-instance-sync.util.test.ts` — hook test via `renderHook` (`__tests__/test-utils`), `jest.unstable_mockModule` on `../api/sdk` (mock `connectorInstances.sync`, `connectorInstances.runningJobs`, `jobs.stream`).

**Tests** (`cd apps/web && npm run test:unit -- --testPathPattern use-connector-instance-sync`)
1. Mount with a running `connector_sync` in `runningJobs` → the stream is opened with that job's id (jobs.stream called with it).
2. Mount with `runningJobs` containing only a non-sync job type → no seed (stream stays null).
3. Mount with empty `runningJobs` → no seed.
4. After `onDismissResult`, a still-stale `runningJobs` result does not re-seed (seed-once guard).
5. Mutation-seeded `jobId` is not overwritten by the running-jobs effect.

## Smoke (manual, against your dev stack)

1. Start a sync that runs ≥15s (e.g. the #458 *Smoke Slow* fixture: `node slow-api.mjs` on :4002, instance "Smoke Slow (local)"; any slow source works). While "Syncing… X of Y records" is showing, **reload the page**: the toast returns within a refetch beat, showing the live counts (not 0, not stale), and completes to the normal tally.
2. Open the instance page in a **second tab** mid-sync (first-visit case): same result.
3. Let the sync finish, dismiss the completion toast, reload: **no toast** appears (nothing running).
4. Visit an instance that has never synced: no toast, no console errors.

## Out of scope

- Re-latching on other views (jobs list/detail already render persisted progress — #458).
- Any backend change — `/running-jobs` and the SSE snapshot already carry what's needed.
- Toast re-latch for non-sync job types (upload/commit flows own their expectations per CLAUDE.md's job-lock UX rules).
