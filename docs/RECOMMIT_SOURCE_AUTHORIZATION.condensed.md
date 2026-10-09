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

## Adversarial

Probes for how #743 breaks. The fix gates a recommit's workbook source on "this instance's own": the instance itself, or an upload session a commit into it already recorded. It also turns cross-org 403s into the unknown-id 404. So the probes ask whether any body can still steer a recommit to data the caller shouldn't reach, whether recorded-session matching can be gamed (another instance's session, a deleted job, a malformed id), and whether any cross-org answer is still distinguishable. **Branch under test:** `fix/743-recommit-source-authorization` (PR [#746](https://github.com/EnterpriseBT/portal-ai/pull/746)). All probes are `— backend` (`curl` against `:3001` with the e2e owner and member tokens, plus SQL). The e2e org has no file-upload or cloud instance with a plan, so each probe seeds what it needs in SQL: instances with `file-upload` / `google-sheets` definitions, plan rows, and `layout_plan_commit` job rows recording a session. Remove all of it afterwards.

### §1 Boundary & limit inputs
- [ ] Recommit bodies that fail the schema: `{}`, `{ "uploadSessionId": "" }`, and both fields at once. Expected safe result: 400 `LAYOUT_PLAN_INVALID_PAYLOAD` from the schema, and no job. — backend

### §2 Malformed & injection input
- [ ] A file-upload instance with a recorded session `S`: recommit with `{ "uploadSessionId": "S' OR '1'='1" }`, then `{ "uploadSessionId": "%" }`. Expected safe result: 400 "The workbook source doesn't belong to this connector instance" for both (the lookup is parameterized and exact-match), and no job. — backend

### §3 Concurrency & races: N/A. The source check is a read before enqueue; it adds no shared state or new write path.

### §4 Auth & permission boundaries
- [ ] The **member** owns a file-upload instance M with a plan. The owner has an upload session `O`, recorded only on the owner's instance A. As the member, recommit M with `{ "uploadSessionId": "O" }`, then with `{ "connectorInstanceId": "A" }`. Expected safe result: 400 for both, with no job on M. — backend
- [ ] As the **member**, recommit the **owner's** instance A, naming A's own recorded session. Expected safe result: 404 `LAYOUT_PLAN_CONNECTOR_INSTANCE_NOT_FOUND` from the URL check, before any source check. — backend

### §5 Multi-tenant isolation
- [ ] As the e2e owner, recommit their own instance naming (a) an Org B upload session id and (b) an Org B instance id, then (c) a random id. Expected safe result: an identical 400 body for all three. — backend
- [ ] `POST /api/file-uploads/confirm` with an Org B upload id vs a random id. Expected safe result: an identical 404 body. — backend

### §6 State & lifecycle abuse
- [ ] File-upload instance F has two recorded sessions, S1 (older) and S2 (newer); S1's job row is then soft-deleted. Recommit with S2 → 202. With S1 → 400 (a deleted record doesn't count). Cancel or clean up the enqueued job. — backend
- [ ] Recommit naming a plan that belongs to a **different** instance (the path instance is writable). Expected safe result: 404 `LAYOUT_PLAN_NOT_FOUND`, and no job. — backend

### §7 Misuse sequences
- [ ] The caller can write two file-upload instances, A and B. Session `SA` is recorded on A only. Recommit **B** with `{ "uploadSessionId": "SA" }`. Expected safe result: 400 and no job. A session belongs to the instance it was committed into, not to everything the caller can write. — backend
- [ ] A Google Sheets instance G: recommit with `{ "connectorInstanceId": G }` → 202. Recommit with a session recorded on G (seeded) → 400. Then a file-upload instance naming itself → 400. No job comes from either 400. — backend

### Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | low / med / high | fixed-in-PR / waived: <reason> |

### Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name>: confirmed against my own running stack

### Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/instance/plan/session/job ids):
