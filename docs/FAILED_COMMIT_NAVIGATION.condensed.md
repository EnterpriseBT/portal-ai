# A failed file-upload commit stays in the dialog — Condensed design (#887)

**Issue:** [EnterpriseBT/portal-ai#887](https://github.com/EnterpriseBT/portal-ai/issues/887) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** A file upload's commit returns 202 with a freshly minted `connectorInstanceId`, and the workflow navigates to `/connectors/:id` straight away. If the job then fails, the worker's final-attempt rollback **hard-deletes** that new instance and its plan. The user is left on "Connector instance not found", with the reason (say, a drift halt) never shown and the regions they drew gone. The workflow's own comment assumes a failed commit "flips the connector instance to status error". That's only true when the instance already existed, which is the Google Sheets and Excel case. The fix keeps a file upload's dialog open until the job finishes. On success it navigates as now; on failure it shows the job's error in the Review step with the user's regions intact, ready to fix and recommit. `apps/web` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| File-upload `runCommit` | `apps/web/src/workflows/FileUploadConnector/FileUploadConnectorWorkflow.component.tsx:540` | `commitMutate` (no `connectorInstanceId`), then a fire-and-forget `awaitJobCompletion(…).finally(invalidate)`; returns on the 202 |
| Navigation | same file `:588` | `onCommitSuccess` → `/connectors/$connectorInstanceId` + close |
| Shared commit step | `apps/web/src/workflows/_shared/spreadsheet/use-spreadsheet-workflow.util.ts:702` | `runCommit` rejects → `serverError: toServerErrorFromUnknown(err)` (`:139`), shown in the Review step's `FormAlert`; resolves → `onCommitSuccess` |
| Job wait | `apps/web/src/utils/job-stream.util.ts:287` | `awaitJobCompletion` resolves on `completed`, rejects with `new Error(data.error)` on `failed`/`cancelled`; the job event carries text, no code |
| Fresh-create rollback | `apps/api/src/services/layout-plan-draft.service.ts:436` | not an existing instance → hard-delete plan + instance on the final attempt (`layout-plan-commit.processor.ts:119`) |
| Existing-instance rollback | same file `:416` | keeps the plan, sets the instance `status: "error"` + `lastErrorMessage` |
| Sheets / Excel `runCommit` | `GoogleSheetsConnectorWorkflow.component.tsx:183`, `MicrosoftExcelConnectorWorkflow.component.tsx:180` | pass `connectorInstanceId: ciId` (created at OAuth), so they take the existing-instance path and land on a page that shows the error |
| Upload session | `layout-plan-draft.service.ts:347` | marked committed only on success, so a failed commit's session is still usable for a retry |
| Recovery on the page | `apps/web/src/views/ConnectorInstance.view.tsx:82` | **Modify Layout Plan** only for `google-sheets` / `microsoft-excel` (`EDIT_PLAN_SLUGS`); a file upload has no upstream to re-plan against |

## Decision — where a failed file-upload commit lands

- **A. Wait in the dialog (chosen).** File upload's `runCommit` awaits the job. On `completed` it returns and the dialog navigates. On `failed`/`cancelled` it throws, so the shared step puts the error in the Review step's `FormAlert`, with the regions, plan and upload session intact. Commit plan retries.
  - Long imports keep the dialog on "Committing…" until they finish, and `Modal` blocks dismissal while pending. That's the honest state: the import is what's running, and the user is already waiting in this dialog for the parse job.
- **B. Server keeps a failed fresh instance in `error`.** The connector page would show the reason. But a file upload has no Modify Layout Plan, so the user still couldn't fix it, and every failed first upload would leave a dead connector to delete. Rejected.
- **C. Navigate, then render the failed job on the 404 page** (job id in the route). This shows the reason but loses the regions, and adds a new page state for one workflow. Rejected.

Sheets and Excel keep navigating on the 202. Their instance survives a failure, and its page shows the error, so they're not affected. Their stale comment is corrected.

**The error text the user sees:** the job's own message, under the web-side code `LAYOUT_PLAN_COMMIT_FAILED`. The job event has no code, and `UNKNOWN_ERROR` would read as a client bug. The message is the job's `error` as written, and #719's `jobErrorText` already keeps it safe for members to read.

## Plan — 1 slice

**Files**
- Edit: `apps/web/src/utils/job-stream.util.ts`: `awaitJobCompletion` rejects a `failed`/`cancelled` job with `JobFailedError` (an `Error` with `status`, same message), so a caller can tell the job's own failure from a dropped stream without matching message text.
- New: `apps/web/src/utils/commit-job.util.ts`: `awaitCommitJob(connect, jobId, { onProgress? })`. It resolves on `completed`, and on `failed`/`cancelled` throws `ApiError` with code `LAYOUT_PLAN_COMMIT_FAILED` and the job's message. It rethrows an SSE connection error as is.
- Edit: `FileUploadConnectorWorkflow.component.tsx`: `runCommit` awaits `awaitCommitJob`, and the cache sweep moves to a `finally` around it. The comment says why file upload waits and the cloud connectors don't.
- Edit: `GoogleSheetsConnectorWorkflow.component.tsx`, `MicrosoftExcelConnectorWorkflow.component.tsx`: comment only (the flip-to-`error` claim is true for them, and says why).
- Edit: `CLAUDE.md` → Async Job State, frontend rules (the Copilot mirror doesn't carry this rule): a workflow whose job **creates** its target (file upload) waits for the job, because a failure deletes the page it would land on. Post-202 navigation stays the rule otherwise.

**Tests** (`npm run test:unit`, apps/web)
- Edit: `apps/web/src/__tests__/job-stream.util.test.ts`: `failed` and `cancelled` reject with `JobFailedError` and the right `status`.
- New: `apps/web/src/__tests__/commit-job.util.test.ts`: `completed` → resolves; `failed` with "Drift at 'warn' severity…" → `ApiError` `LAYOUT_PLAN_COMMIT_FAILED` carrying that message; `cancelled` → the same code with "Job cancelled"; an SSE error → rethrown unchanged.
- Edit: `workflows/FileUploadConnector/__tests__/file-upload-workflow.util.test.ts`: a `runCommit` that rejects with that `ApiError` leaves the phase on `review`, sets `serverError` to it, keeps `regions`/`plan`, and never calls `onCommitSuccess`. A second Commit after that calls `runCommit` again.

## Smoke (manual, against your dev stack)

1. Upload `packages/e2e/src/fixtures/core-loop.csv` with the Anthropic stub that left columns unbound in #489 (or any region whose commit drift-halts). Click **Commit plan**: the button reads "Committing…", the dialog can't be dismissed, then the Review step shows `FormAlert` "Drift at 'warn' severity — region drift knobs require halt. (LAYOUT_PLAN_COMMIT_FAILED)". No navigation; the regions are still drawn.
2. Backend: `jobs` has the `layout_plan_commit` row `failed`, and no `connector_instances` row for its `connectorInstanceId` (the rollback ran).
3. Fix the region (bind the columns) and **Commit plan** again: it succeeds and lands on `/connectors/<new id>` with the entities listed, with no lock alert left behind.
4. A clean upload commits and lands on the connector page as before. The button shows "Committing…" until the job finishes.
5. A Google Sheets commit still navigates on the 202 (unchanged).

## Out of scope

- **Showing commit progress percent in the dialog.** `awaitCommitJob` accepts `onProgress`, but rendering it is a follow-up if long imports make the wait feel stuck.
- **Changing the server's fresh-create rollback** (decision B).
