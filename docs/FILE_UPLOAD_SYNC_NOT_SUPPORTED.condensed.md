# A connector with no adapter can't sync — Condensed design (#772)

**Issue:** [EnterpriseBT/portal-ai#772](https://github.com/EnterpriseBT/portal-ai/issues/772) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `POST /api/connector-instances/<file-upload>/sync` answers `500 JOB_ENQUEUE_FAILED` ("Internal server error") and logs an error, when the right answer is the predictable refusal sandbox already gets: `400 SYNC_NOT_SUPPORTED`. File upload has no connector adapter by design (it's parsed through the upload workflow, not synced), and the adapter lookup throws a plain `Error` that the route wraps as a 500. The same lookup makes the wide-table resync count every file-upload connector as **failed** instead of **unsupported**. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Adapter lookup | `apps/api/src/adapters/adapter.registry.ts:19` (`get`) | throws a plain `Error` for an unregistered slug; `find` (`:32`) returns `undefined` |
| Registered adapters | `apps/api/src/adapters/register.ts` | sandbox, google-sheets, microsoft-excel, rest-api; **no file-upload** |
| `SyncService.resolveAdapter` | `apps/api/src/services/sync.service.ts:36,65` | 404 for a missing instance, 500 for a missing definition, then `Registry.get` |
| `assertEligibleForSync` | `sync.service.ts:124–158` | `!adapter.syncInstance` → `400 SYNC_NOT_SUPPORTED`; never reached for file upload |
| Sync route catch | `apps/api/src/routes/connector-instance.router.ts:1951–1964` | any non-`ApiError` → `500 JOB_ENQUEUE_FAILED`, logged at error |
| Test-connection route | `connector-instance.router.ts:1845–1856` | same `resolveAdapter`; `!adapter.testConnection` → `404 TEST_CONNECTION_NOT_SUPPORTED`, but a file upload 500s first |
| Resync fan-out | `apps/api/src/services/wide-table-resync.service.ts:72–76` | `Registry.get` throws inside the per-instance `try`, so a file upload lands in `failed`, not `skippedUnsupported` |
| Sync processor | `apps/api/src/queues/processors/connector-sync.processor.ts:80` | `Registry.get` in the worker; only reached after the route's eligibility check, and a plain `Error` there is a correct job failure |
| Detail `syncEligible` | `connector-instance.router.ts:397–401` | already skips the adapter unless `capabilityFlags.sync`; unaffected |

## Decision — where a missing adapter becomes "not supported"

- **A. Throw `ApiError` from the registry.** It puts HTTP semantics in the adapter layer and would pick one code for every caller, though sync wants `SYNC_NOT_SUPPORTED` and test-connection wants `TEST_CONNECTION_NOT_SUPPORTED`.
- **B. Register an empty file-upload adapter.** It fixes only that one slug (any other unregistered slug still 500s) and adds a stub adapter, a pattern nothing else uses.
- **C. Treat a missing adapter as an adapter with no capabilities.** `resolveAdapter` uses `Registry.find` and returns `adapter: ConnectorAdapter | undefined`. Each caller's existing capability check reads `adapter?.syncInstance` / `adapter?.testConnection`, so a missing adapter gets the refusal that caller already gives. Resync uses `find` the same way.

**Decision: C.** "No adapter" and "an adapter without `syncInstance`" mean the same thing to every caller, and each caller already knows its own refusal. No new code, no new pattern, and any future unregistered slug behaves correctly. The registry's `get` keeps throwing for the worker, where a missing adapter after an accepted enqueue really is a failure.

## Plan — one slice

**Files**
- Edit `apps/api/src/services/sync.service.ts`:
  - `resolveAdapter` calls `ConnectorAdapterRegistry.find` and returns `adapter: ConnectorAdapter | undefined`. Its doc comment says a missing adapter means no capabilities.
  - `assertEligibleForSync` checks `!adapter?.syncInstance` and calls `adapter.assertSyncEligibility` only when an adapter exists.
- Edit `apps/api/src/routes/connector-instance.router.ts`: the test-connection route checks `!adapter?.testConnection`.
- Edit `apps/api/src/services/wide-table-resync.service.ts`: `find`, and `!adapter?.syncInstance` → `skippedUnsupported`.

**Tests** (failing first; `AUTH_API_RATE_LIMIT_PER_MIN=1000000 npm run test:integration -- --testPathPattern …` from `apps/api`)
- `src/__tests__/__integration__/routes/connector-instance.router.integration.test.ts`, in the `POST …/:id/sync` block: an instance whose definition slug has no adapter (`file-upload`) → `400 SYNC_NOT_SUPPORTED`, and no `connector_sync` job row is written.
- `src/__tests__/__integration__/routes/connector-instances.test-connection.integration.test.ts`: the same kind of instance → `404 TEST_CONNECTION_NOT_SUPPORTED`.
- `src/__tests__/__integration__/services/wide-table-resync.service.integration.test.ts`: a file-upload instance lands in `skippedUnsupported`, and `failed` stays `[]`.
- Then `npm run type-check`, `npm run lint` (api).

## Smoke (manual, against your dev stack)

1. Pick a File Upload connector (any `db:demo:seed` org; the e2e fixture's "File Upload — CSV"). `POST /api/connector-instances/<id>/sync` with an owner token → `400`, `code: SYNC_NOT_SUPPORTED`, message `Connector type "file-upload" does not support sync`. The API log has no `Failed to enqueue sync job` error for it, and `jobs` gains no `connector_sync` row. — backend
2. `POST /api/connector-instances/<same id>/test-connection` → `404 TEST_CONNECTION_NOT_SUPPORTED`, not a 500. — backend
3. A Sandbox connector's sync still answers `400 SYNC_NOT_SUPPORTED`, and a Google Sheets connector with a committed plan still answers `202` with a `jobId`. — backend
4. The File Upload connector's page still shows no Sync button, and nothing else on it changed.

## Out of scope

- Ordering the running-sync check before eligibility. With this fix a file upload refuses with a 400 before it would reach `SYNC_ALREADY_RUNNING`, which is correct: it can never have a sync running.
- `ConnectorAdapterRegistry.get` and the sync processor: an unregistered slug inside an accepted job is a real failure, so a plain `Error` there is right.
- Giving file upload an adapter (re-upload as "sync"): that would be a feature, not this bug.

## Adversarial

Probes against the dev API, with the fixture's File Upload — CSV connector (`29c3dcef…`) and two probe rows: a file-upload connector in another org, and a soft-deleted one in the fixture org. Skipped categories: boundary inputs and injection (the routes take no input beyond the id), and UI (the page shows no Sync button).

- [ ] **Cross-org.** Sync and test-connection on another org's file-upload id → 404 `CONNECTOR_INSTANCE_NOT_FOUND`, with no `SYNC_NOT_SUPPORTED` and no slug, so nothing tells the caller that the connector exists or what type it is. — backend
- [ ] **Missing and soft-deleted.** A nonexistent id, and a soft-deleted file-upload connector, on sync and test-connection → 404 `CONNECTOR_INSTANCE_NOT_FOUND`. — backend
- [ ] **Permission before capability.** As a member without write on the connector, sync → 403 `PERMISSION_DENIED` (not the 400). Test-connection only needs read, so the member gets 404 `TEST_CONNECTION_NOT_SUPPORTED`. — backend
- [ ] **Parallel clicks.** Ten concurrent syncs on the file-upload connector → ten 400s, and `jobs` gains no `connector_sync` row. — backend
- [ ] **A body that pretends to be another type.** Sync with `{"force":true,"slug":"google-sheets"}` → still 400 `SYNC_NOT_SUPPORTED` for `file-upload`. The type comes from the stored definition, never the body. — backend

### Findings

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| Parallel clicks / smoke step 1 | Each 400 still logs `Failed to enqueue sync job` at error level (same as the code-review finding) | low | fixed-in-PR: the sync and test-connection catches log only unexpected failures |
| Body pretending to be another type | The sync route accepts and ignores an unknown body (no strict schema). The type can't be overridden; pre-existing, and not from this change | low | |
