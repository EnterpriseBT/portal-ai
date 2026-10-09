# A recommit reads only its own instance's workbook — Condensed design (#743)

**Issue:** [EnterpriseBT/portal-ai#743](https://github.com/EnterpriseBT/portal-ai/issues/743) · Bug (security) · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The layout-plan **recommit** route checks write access only on the instance in the URL. The workbook source in the **body** (`uploadSessionId` or `connectorInstanceId`) goes into the job unchecked, and the worker reads it with an org check alone. So a member who can write instance A could name another member's upload session, or another instance (read with that member's stored OAuth connection), and copy its contents into A. That's a same-org bypass of per-object authorization (#685). The existing route test proves it by accident: it sends a **random** `uploadSessionId` and expects 202 (`connector-instance-layout-plans.router.integration.test.ts:731`). Separately, five service sites answer another org's instance id with **403** "belongs to a different organization" while an unknown id gets 404. That's an existence oracle (#713), and through the recommit hole it reaches the job's `error`. Only `apps/api` changes.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Recommit route | `routes/connector-instance-layout-plans.router.ts:596` | `ConnectorInstanceAccessService.load(path id, "write")`; then `workbookSource` straight from the body (`:625-633`) |
| Enqueue | `services/layout-plan-draft.service.ts:431` `prepareRecommit` | checks the path instance and the plan; copies `workbookSource` into the job metadata unchecked |
| Worker read | `layout-plan-draft.service.ts:561` `resolveWorkbookBySource` | `GoogleSheets/MicrosoftExcelConnectorService.resolveWorkbook(id, org)`; `FileUploadSessionService.resolveWorkbook(id, org)`: an org check, no owner check |
| What the web app sends | `apps/web/src/views/EditLayoutPlan.view.tsx:678-683` | cloud: `{ connectorInstanceId }` = **the URL's instance**; file-upload: `{ uploadSessionId }` from edit-context |
| Where that session comes from | `services/connector-instance-layout-plans.service.ts:320-330` | `jobs.findLatestUploadSessionIdForConnectorInstance(instance, org)`: the instance's **own** latest session, which may have been uploaded by another member |
| Draft-commit precedent | `routes/layout-plans.router.ts:31` `assertSourceAccessible` | the caller's own session, or an instance they can read/write; right for a *new* draft, wrong for a recommit (an admin's recommit of a member's instance uses that member's session) |
| Cross-org 403s | `google-sheets-connector.service.ts:387`, `:447`; `microsoft-excel-connector.service.ts:436`, `:562`; `layout-plan-draft.service.ts:155` | `403 CONNECTOR_INSTANCE_NOT_FOUND` "belongs to a different organization" |

## Decision — the body source must be the instance's own source

Options: (a) reuse `assertSourceAccessible` (the caller's own session). That breaks a legitimate recommit by another writer, because the instance's session belongs to whoever uploaded it. (b) Ignore the body and derive the source on the server. That's safest, but it drops a required field from the contract. (c) **Derive the instance's source the way edit-context does, and require the body to name exactly that.**

**Decided: (c).** For a cloud instance, the body's `connectorInstanceId` must equal the URL's. For file-upload, `uploadSessionId` must equal `findLatestUploadSessionIdForConnectorInstance(URL instance, org)`. Anything else, including an unknown id or another org's, gets one 400 `LAYOUT_PLAN_INVALID_PAYLOAD` "The workbook source doesn't belong to this connector instance". It's the same answer for every mismatch, so it reveals nothing, and it runs after the URL instance's write check, so an unwritable instance still gets 404 first. The web app already sends exactly this, so the contract and client are unchanged. The check lives in `prepareRecommit`, beside the instance and plan checks it already makes. No worker re-check is needed: the source is pinned to the instance, not to the caller, and the instance check is the existing one.

The five **cross-org 403s become 404 `CONNECTOR_INSTANCE_NOT_FOUND` "Connector instance not found"**, identical to the unknown-id branch above each (an unreadable object is absent, #713). #742's guard (`invalid-request-code.guard.test.ts`) is extended from 400 to **every non-404 4xx** with a `*_NOT_FOUND` code, with `MEMBERSHIP_NOT_FOUND` (×2, "you aren't a member") allowlisted.

## Plan — one slice

**Files**
- `services/layout-plan-draft.service.ts`: `prepareRecommit` validates `workbookSource` against the instance's own source (this needs the instance's connector slug); the cross-org 403 at `:155` becomes the 404.
- `services/google-sheets-connector.service.ts`, `services/microsoft-excel-connector.service.ts`: the four cross-org 403s become the 404.
- `__tests__/invalid-request-code.guard.test.ts`: scan non-404 4xx; allowlist `MEMBERSHIP_NOT_FOUND`.
- `@openapi` on the recommit route: the 400 names the new rule.

**Tests** (failing first, as the reproduction)
- `connector-instance-layout-plans.router.integration.test.ts`: the existing 202 test seeds a real session for the instance instead of a random id. New tests: another session id → 400, no job row; a cloud recommit naming a different instance (same org) → 400, no job; the instance's own source → 202.
- `same-org-access.authorization.integration.test.ts`: a writer recommitting their **own** instance while naming **another member's** upload session or instance → 400, no job.
- Service unit tests (or integration): `resolveWorkbook` / `fetchWorkbookForSync` / `prepareDraftCommit` with another org's instance → 404, the same body as an unknown id.
- The guard's self-test: a 403 `*_NOT_FOUND` is flagged and `MEMBERSHIP_NOT_FOUND` passes.
- `npm run type-check`, `lint`, the touched unit and integration suites.

## Smoke (manual, against your dev stack)

1. As the e2e owner, with a file-upload instance you can write and a plan on it, `POST …/layout-plan/<plan>/commit` with `{ "uploadSessionId": "<a random id>" }` → **400** `LAYOUT_PLAN_INVALID_PAYLOAD`, and no new `layout_plan_commit` job row.
2. The same with `{ "connectorInstanceId": "<another instance id>" }` → 400, with no job.
3. From the app, edit that instance's layout plan and recommit → it enqueues (202) and completes, so the web body still passes.
4. `select count(*) from jobs where type = 'layout_plan_commit' and created > <start>` matches only step 3.

## Out of scope

- Re-sourcing a recommit from a different instance or session as a feature. Nothing uses it, and it would need its own authorization model.
- #745 (validation-error consistency).
