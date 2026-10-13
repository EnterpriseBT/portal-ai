# A sync job that can never run fails on its first attempt — Condensed design (#774)

**Issue:** [EnterpriseBT/portal-ai#774](https://github.com/EnterpriseBT/portal-ai/issues/774) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The `connector_sync` processor throws a plain `Error` when the job's connector, its definition, its adapter, or the adapter's `syncInstance` is missing. BullMQ treats a plain error as retryable, so the worker writes `pending` and retries until all 3 attempts are spent (#441). The whole time, the job holds the connector's instance lock (#769), so every write to the connector and its entities is refused for a sync that can never succeed. #772 closed the route path to this, but a job queued before that fix, or a future enqueue path that skips `assertEligibleForSync`, still lands here. The trap behind #772 is also still in place: `ConnectorAdapterRegistry.get` throws a plain `Error`, and the registry's usage example shows `get`. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Missing instance / definition | `apps/api/src/queues/processors/connector-sync.processor.ts:65–78` | plain `Error` for each. `findById` skips soft-deleted rows, so a connector deleted while its sync was queued lands here too |
| Missing adapter / `syncInstance` | `connector-sync.processor.ts:80–85` | `ConnectorAdapterRegistry.get` throws a plain `Error`; `!adapter.syncInstance` throws another |
| Retry decision | `apps/api/src/queues/jobs.worker.ts:122–130` (`statusForFailedAttempt`) | `UnrecoverableError` → `failed` on arrival; anything else → `pending` until `attempts` (3, `jobs.queue.ts:32`) is spent |
| Worker-side coverage | `src/__tests__/queues/jobs.worker.retry.test.ts:171` | already asserts `failed` for `UnrecoverableError` with budget left |
| Precedent | `apps/api/src/queues/processors/dissolve-precompute.processor.ts:226` | throws `UnrecoverableError` for a deterministic refusal, and keeps a plain error where a retry can succeed (`:234`) |
| Registry | `apps/api/src/adapters/adapter.registry.ts:8,19,32` | the usage example shows `get`; `get` throws a plain `Error`; `find` returns `undefined` |
| `get` callers | the processor (`:80`) only, plus `adapter.registry.test.ts` and `register.test.ts` | every request path has used `find` since #772 |

## Decision 1 — what the processor treats as final

- **A. Only a missing adapter or `syncInstance`.** This leaves a deleted connector or definition retrying, and those are just as permanent: there is no undelete path.
- **B. All four missing-prerequisite checks.** Each is a fact about stored state that a retry a few seconds later can't change. A failing DB read throws from `findById` itself, so it stays retryable.

**Decision: B.** Each of the four throws `UnrecoverableError` with the same message as today, so the job's `error` text doesn't change; only the retry behavior does.

## Decision 2 — the registry trap

- **A. Rename `get` to `getOrThrow`.** It keeps a throwing lookup that has one caller, and that caller is about to stop needing it.
- **B. Make `get` throw a typed error the worker classifies.** That couples the adapter layer to BullMQ's retry semantics.
- **C. Remove `get`.** The processor uses `find` and decides for itself. `find` becomes the only lookup, so nothing can copy a throwing lookup into a request path again.

**Decision: C.** It's a clean cut, with no compat alias (internal API). The usage example and `find`'s doc comment change to match. `find`'s comment still says only the redaction serializer uses it.

## Plan — one slice

**Files**
- Edit `apps/api/src/queues/processors/connector-sync.processor.ts`:
  - import `UnrecoverableError` from `bullmq`;
  - throw it for a missing instance, definition, adapter (`ConnectorAdapterRegistry.find`) or `syncInstance`;
  - add a comment citing #774.
- Edit `apps/api/src/adapters/adapter.registry.ts`: remove `get`, and update the usage example and `find`'s doc comment.

**Tests** (failing first; `npm run test:unit -- --testPathPattern …` from `apps/api`)
- `src/__tests__/queues/processors/connector-sync.processor.test.ts`:
  - mock `find` instead of `get`;
  - add a `describe` that checks each of the four cases rejects with an `UnrecoverableError` carrying today's message, and that the lock and adapter are never called.
- `src/__tests__/adapters/adapter.registry.test.ts`: the `get` block becomes a `find` block (returns the adapter; `undefined` for an unregistered slug), and the `register` overwrite case uses `find`.
- `src/__tests__/adapters/register.test.ts`: `find(...)!` in place of `get`.
- Then `npm run type-check`, `npm run lint` (api), and a grep that confirms no `ConnectorAdapterRegistry.get(` is left.

## Smoke (manual, against your dev stack)

The failing path isn't reachable from the running app since #772: the route refuses before enqueueing, and the processor checks run before any work. The processor unit tests cover it. The smoke checks that the normal sync path is unchanged:

1. `POST /api/connector-instances/<a Google Sheets connector with a committed plan>/sync` → `202` with a `jobId`. The job reaches `completed` with `attempts` 1, and the connector's records refresh. — backend
2. A File Upload connector's sync still answers `400 SYNC_NOT_SUPPORTED`, and a Sandbox connector's still answers `400 SYNC_NOT_SUPPORTED` (#772 unchanged). — backend
3. On the Google Sheets connector's page, Sync still runs end to end, and the lock alert appears and then clears when the job finishes.

## Out of scope

- Other processors' plain errors for missing rows. Each needs its own judgment about what a retry can fix; this ticket is the sync path that #772 exposed.
- Reaping `connector_sync` jobs already retrying in a deployed environment. Their budget runs out on its own within the existing backoff, and `POST /api/jobs/:id/cancel` is the escape hatch.
- #775 (the sync route's request body), filed separately.
