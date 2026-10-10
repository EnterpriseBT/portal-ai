# Request guard regressions — Condensed design (#753)

**Issue:** [EnterpriseBT/portal-ai#753](https://github.com/EnterpriseBT/portal-ai/issues/753) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #751's guard broke three things:
- A run started after a workflow reset is swallowed by the stale run.
- A throw while building a request crashes the handler instead of reaching `onError`.
- A manual refresh joins an older in-flight read.

Separately, `useAuthMutation` resends writes up to 3 times on network errors and 5xx, so a lost response creates a duplicate. This fixes those four, all in `apps/web`. Chained and local-state double submits, the Connect double popup and the post-settle gap are **accepted**: the loading state covers them in practice (see the issue's `## Scope (amended)`).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Action single-flight | `utils/use-single-flight.util.ts:25–32` | one `running` ref; nothing clears it on reset |
| Wrapped workflow actions | `workflows/_shared/spreadsheet/use-spreadsheet-workflow.util.ts:693` (`onInterpret`), `:726` (`onCommit`); `workflows/FileUploadConnector/utils/file-upload-workflow.util.ts:315` (`startParse`) | |
| Resets | core `reset` `:736`; FileUpload `reset` `:317`; Google Sheets / Excel reselect call `core.reset()` (`google-sheets-workflow.util.ts:212`, `microsoft-excel-workflow.util.ts:223`) | bump the run token, but leave the single-flight held |
| Request single-flight | `utils/api.util.ts:300` (`dedupeInFlight = true`), `:351–354` (key built synchronously, before react-query) | a throw there escapes `mutate`; GET is deduped too |
| POST reads | `api/portal-sql.api.ts:67` (`widgetRefresh`), `api/portal-results.api.ts:91` (`refresh`) | a manual refresh joins the auto-refresh |
| Mutation retry | `client.ts:23–30` (`shouldRetry`), `:70` (`mutations.retry`), `:36` comment | retries writes on `TypeError` and 5xx, despite "a write is never resent" |

## Decision — release on reset; fall back on a throw; reads and writes split by method

- **Superseded runs:** `useSingleFlight`'s wrapper gains a `release()` that drops the held run, so the next call starts fresh. The stale run still discards its own result through its token check. Core `reset()` releases `onInterpret` and `onCommit`, and FileUpload `reset()` releases `startParse`; the Google Sheets and Excel reselects go through `core.reset()`. A `generation` option was rejected: the runs claim their token *inside* the action, so a pre-call generation can't match the running one.
- **Request-build throws:** `useAuthMutation` computes the key in a `try/catch`. On a throw the key is `null`, so it calls `mutation.mutateAsync` undeduplicated, and the same throw happens inside `mutationFn` and reaches `onError` / `mutation.error`, as before #751.
- **Reads and writes:**
  - **Reads:** `dedupeInFlight` defaults to `method !== "GET"`, and the two POST reads pass `dedupeInFlight: false`.
  - **Writes:** `useAuthMutation` sets `retry: false` for non-GET unless the caller's `mutationOptions.retry` says otherwise. GET-shaped calls keep `client.ts`'s `shouldRetry`. The `client.ts:36` comment is corrected.

Rejected: the one-shared-submit-guard design (registry plus `useGuardedAction` across ~45 sites), as disproportionate to windows of a render or less.

## Plan — 2 slices

**Slice 1: `useAuthMutation`.**
- **Files:** `utils/api.util.ts`, `api/portal-sql.api.ts`, `api/portal-results.api.ts`, `client.ts` (comment).
- **Tests:** extend `__tests__/auth-mutation-single-flight.test.tsx`:
  - a throwing `url()` and a circular body → `onError` gets the error, nothing thrown from `mutate`;
  - two identical GET calls → two fetches;
  - a write that fails with a `TypeError` → one fetch, no retry;
  - a GET that fails → retried per `shouldRetry`;
  - an explicit `mutationOptions.retry` wins.

  `__tests__/client.test.ts` is unchanged (`shouldRetry` itself doesn't change).

**Slice 2: release on reset.**
- **Files:** `utils/use-single-flight.util.ts` (`release`), `use-spreadsheet-workflow.util.ts` and `file-upload-workflow.util.ts` (call it in `reset`).
- **Tests:**
  - `__tests__/use-single-flight.test.ts`: after `release()`, a call while the old run is pending starts a new run.
  - `workflows/FileUploadConnector/__tests__/file-upload-workflow.util.test.ts`: `startParse` pending, `reset()`, add a file, `startParse` → `parseFile` called twice. Same for `onCommit` after `reset()`.

Run `npm run test:unit -- --testPathPattern '<files>'` in `apps/web`, then `type-check`, `lint` and `format:check`.

## Smoke (manual, against your dev stack)

1. **File upload:** add a large file and click Upload. While it uploads, close the workflow, reopen it, add a different file and click **Upload** → the new file uploads at once; it doesn't wait for or join the old one.
2. **A portal with a refreshable widget:** reload the page and immediately click the widget's **Refresh** while the auto-refresh is running → DevTools shows **two** refresh requests, and the widget ends on the second one's data.
3. **New Station** with DevTools Network request blocking on `/api/stations` (block the URL, click **Create**, then unblock) → exactly **one** failed `POST /api/stations` (no automatic retries), and the dialog shows the error. Clicking **Create** again sends one POST.
4. **Regression check for #751:** double-click **Create** on New Station → one `POST /api/stations`.

## Out of scope

- Chained and local-state double submits, the Connect double popup, and the post-settle gap: accepted (issue `## Scope (amended)`).
- Server-side idempotency keys; converting the POST reads to GET.
