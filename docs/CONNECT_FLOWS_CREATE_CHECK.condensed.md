# Connect flows enforce the connector-instance create check — Condensed design (#710)

**Issue:** [EnterpriseBT/portal-ai#710](https://github.com/EnterpriseBT/portal-ai/issues/710) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Touches authorization, so security review is **required**.

**Why.** Creating a connector instance is an owned create, `resource.write connector_instance` with `createdBy: caller`. `POST /api/connector-instances` checks it, but three of the five connect flows create an instance without it: Google Sheets and Microsoft Excel (authorize, then an OAuth callback that inserts) and file upload (`POST /api/layout-plans/commit` with no `connectorInstanceId`). Under the seeded policies every member holds the grant, so default roles see no difference. An org that uses custom RBAC to deny it is silently not enforced on those three flows, and #708's Connect gate overstates what the server enforces. This applies the existing check to the three flows. `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Owned create check (the reference) | `routes/connector-instance.router.ts:772-775` | `PermissionService.check(caller, "resource.write", { type: "connector_instance", createdBy: caller.userId })` |
| `CREATE_RULES.connector_instance = "owned"` | `services/permission.service.ts:115`, `canCreate` at `:304-318` | What #708's `create` capability computes; the routes must agree with it |
| Sheets authorize | `routes/google-sheets-connector.router.ts:70-112` | Write check only inside `if (connectorInstanceId)` (reconnect) |
| Sheets callback insert | `services/google-sheets-connector.service.ts:140` | Public route, no JWT; only `verifyState` (userId/orgId from signed state) |
| Excel authorize / insert | `routes/microsoft-excel-connector.router.ts:52-100` / `services/microsoft-excel-connector.service.ts:181` | Same shape as Sheets |
| OAuth state TTL | `utils/oauth-state.util.ts:11` | `STATE_TTL_MS` = 5 min: authorize → callback window |
| Layout-plan commit | `routes/layout-plans.router.ts:189-215` | `assertSourceAccessible(…, "write")` (`:30-50`) checks upload ownership only, then `prepareDraftCommit` |
| Draft-commit insert | `services/layout-plan-draft.service.ts:182-183` | `connectorInstances.create` in the no-`connectorInstanceId` branch |
| Route-authz map | `__tests__/config/route-authorization.map.ts:603-613, 667-669` | Records a new connection as "the caller's own": ownership, not the create permission |
| Roles for a non-JWT context | `middleware/metadata.middleware.ts:94` | `userRole.findEffectiveRoleNames(userId, orgId)` builds `PermissionContext.roles` |
| Agreement test | `__tests__/__integration__/routes/create-capability.agreement.integration.test.ts` | Drives the create routes against `canCreate` (#708); covers `POST /api/connector-instances` only |

## Decision — where the check sits

**Options.** (A) Authorize only, as the issue proposes: refuse before the OAuth redirect, the right UX. But the insert happens up to 5 minutes later in a callback that evaluates nothing, so a grant revoked in that window, or a member removed in it, still creates. (B) Callback only: enforces at the write, but the user goes through consent first and then gets an error in the popup. (C) Both: authorize refuses up front, and the callback re-checks right before the insert.

**Chosen: C for Sheets/Excel; at the route for commit.**
- **Authorize** (both routers): when `connectorInstanceId` is absent, run the owned create check before `buildConsentUrl`. A refusal is `403 PERMISSION_DENIED` via the existing `ApiError` passthrough in the `catch`.
- **Callback** (both services, new-connect branch only): require a live membership, then build a `PermissionContext` from the signed state (`userId`, `organizationId`, `roles` from `findEffectiveRoleNames`) and run the same check before `connectorInstances.create`. The boundary sits at the write. It costs one `loadSet` per connect, and a refusal there goes through `next(err)` like an expired state does today. One shared helper (`ConnectorInstanceAccessService.assertCanCreate(ctx)`) so all five call sites run the identical check. The generic route moves to it too.
- **Commit**: in `/api/layout-plans/commit`, when `connectorInstanceId` is absent, call `assertCanCreate(caller)` beside `assertSourceAccessible` and before `prepareDraftCommit`. The route is JWT-authenticated and the insert is synchronous, so there is no window to close. `/interpret` creates nothing and is unchanged.
- **Reconnect paths are unchanged**: they already require write on the existing instance.

## Plan — 1 slice

**Files**
- edit `services/connector-instance-access.service.ts`: add `static assertCanCreate(ctx: PermissionContext)` (the owned check).
- edit `routes/connector-instance.router.ts`: replace the inline check at `:772-775` with the helper.
- edit `routes/google-sheets-connector.router.ts`, `routes/microsoft-excel-connector.router.ts`: check on new-connect in authorize; update the `@openapi` 403 description.
- edit `services/google-sheets-connector.service.ts`, `services/microsoft-excel-connector.service.ts`: re-check in the new-connect branch of `handleCallback`.
- edit `routes/layout-plans.router.ts`: check on commit without `connectorInstanceId`; add 403 to `@openapi`.
- edit `__tests__/config/route-authorization.map.ts`: the three `by:` strings name the owned create check (#710).

**Tests** (integration; run with `npm run test:integration -- --testPathPattern '<file>'` from `apps/api`)
- `__integration__/routes/google-sheets-connector.router.integration.test.ts`, `…/microsoft-excel-connector.router.integration.test.ts`: a caller denied `write connector_instance` gets 403 from authorize (new-connect) with no consent URL. A callback whose state was minted before the deny landed returns 403 and creates no row. Existing happy-path and reconnect tests guard the permitted paths.
- `__integration__/routes/layout-plans.router.integration.test.ts`: denied caller → 403 on a new-connection commit, no `connector_instances` row and no job.
- `__integration__/routes/create-capability.agreement.integration.test.ts`: the generic route, Sheets authorize and Excel authorize each agree with `canCreate` for owner, seeded member, instance-only grant and an explicitly denied member. Commit is held in the layout-plans file because it needs a seeded upload session.
- Shared helper `denyForUser` in `__integration__/utils/application.util.ts`.
- The route-authorization guard test passes with the updated map.

## Smoke (manual, against your dev stack)

1. As the e2e **admin**, author a custom policy for the **member** that denies `write connector_instance`, and attach it. The e2e org has `customRbac`.
2. As the member, `curl -X POST :3001/api/connector-instances` with a REST body → **403 `PERMISSION_DENIED`** (baseline, unchanged).
3. As the member, `POST :3001/api/connectors/google-sheets/authorize` with `{}` → **403 `PERMISSION_DENIED`**, no consent URL returned.
4. Same for `POST :3001/api/connectors/microsoft-excel/authorize` → **403**.
5. The seeded member can't open Connectors (MemberAccess has no `view page:connectors`), so walk 5–7 as the e2e **admin** added to the same deny group. Open File Upload while permitted, upload a CSV up to Review, re-apply the deny, then **Commit plan** → the dialog shows "You don't have permission to create or edit connectors. (PERMISSION_DENIED)". `psql`: no new `connector_instances` row, no `layout_plan_commit` job.
6. Connectors → Catalog while denied: **Connect is hidden** on every card (`ConnectorDefinition.component.tsx` hides it when `create` is false), and it reappears once the deny is lifted, matching steps 3–5.
7. Lift the deny and retry **Commit plan** → instance created and `active`, commit job completes. Reconnect an existing Sheets instance the caller owns → still works (manual: real Google consent).
8. (callback window, backend) As the member, mint a Sheets authorize URL, attach the deny policy, then complete consent within 5 min → the callback errors and creates no row.

## Out of scope

- System inserts that no caller drives (`application.service.ts:703` sandbox auto-provision, `demo-seed.service.ts:529`): they don't run under a caller's permissions.
- Making the OAuth popup render a friendly page for a callback refusal. It shows the same raw error as an expired state today, and after the authorize check it is reachable only when a grant changes within the 5-minute window.
- Frontend changes: #708 already gates Connect on `canCreate`. This ticket makes the server match that gate.

## Adversarial

Probes for #710's new create checks (Sheets/Excel authorize + callback, file-upload commit). **Branch under test:** `fix/710-connect-flows-create-check` (PR [#716](https://github.com/EnterpriseBT/portal-ai/pull/716)). Nearly every probe is an API call: the surfaces are routes, and the UI already hides Connect.

**Fixture:** a **denied** caller (the e2e member in a group whose policy denies `write connector_instance`), plus a bearer token pulled from that identity's saved e2e login (`packages/e2e/.auth/`). **Reset:** delete the deny group and policy afterwards, and confirm the member's `connector_instance.create` is true again.

### §1 — Boundary input
- [ ] Denied caller: authorize (Sheets, then Excel) with `{"connectorInstanceId": ""}` → **403 `PERMISSION_DENIED`**, no consent URL. An empty id is a new connection, not a skipped check. — backend
- [ ] Denied caller: authorize with `{"connectorInstanceId": " "}` (whitespace) → **404 `CONNECTOR_INSTANCE_NOT_FOUND`**, no consent URL. It is treated as a reconnect of a row that doesn't exist. — backend
- [ ] Denied caller: commit with `uploadSessionId` + `"connectorInstanceId": ""` → **400 `LAYOUT_PLAN_INVALID_PAYLOAD`** (schema `min(1)`), nothing written. — backend

### §2 — Malformed input
- [ ] Denied caller: authorize with `connectorInstanceId` as a number, array, object or `null` → **403** in every case. A non-string falls to the new-connection branch, which runs the create check. — backend
- [ ] Denied caller: commit with both `uploadSessionId` and `connectorInstanceId` → **400**, no instance row and no job. — backend

### §3 — Concurrency & races
- [ ] Grant revoked between Review and **Commit plan** (walked in smoke step 5) → commit refused with a readable error, 0 instances, 0 jobs. Retrying after the grant is restored succeeds once. No duplicate instance.
- [ ] Deny applied after authorize but before consent completes (inside the 5-minute state window) → callback refused **before the code exchange**, no `connector_instances` row. — manual (real Google consent)

### §4 — Permission boundaries
- [ ] A user whose only grant is instance-scoped (`write connector_instance:<X>`, no owned create): authorize with `connectorInstanceId: X` → **200** (reconnect still works). With no id → **403**. Proves the create check doesn't break reconnect. — backend
- [ ] Denied caller: authorize with the id of another member's instance they can read but not write → **403**, not a consent URL. — backend
- [ ] The same instance-scoped user commits to instance X (`connectorInstanceId` path) → not refused by the create check. Only a create is gated; the existing write check on X decides. (The denied fixture can't run this probe: its deny also blocks writes to its own instances.) — backend

### §5 — Multi-tenant isolation
- [ ] Authorize with a `connectorInstanceId` from another org → **404**, no consent URL. — backend
- [ ] Commit with an `uploadSessionId` belonging to another org or another member → **404** from the source check, before any create. — backend
- [ ] A user denied in org A but permitted in org B, active in B: authorize → 200 and the state carries org B. Switch the active org to A and authorize → 403. The check follows the request's org, not a cached one. — backend

### §6 — State & lifecycle
- [ ] Member **removed from the org** after authorize, then completes the callback within 5 minutes → expected: refused, no row. The security review flagged this as unconfirmed: the callback re-reads roles, but a leftover user-principal or group policy could still grant the create. — manual (real Google consent; record the observed result in Findings)
- [ ] Callback replayed with the same `state` after a successful connect → no second instance beyond what the flow allows; the expired state returns 400 after 5 minutes. — manual

### §7 — Misuse sequences
- [ ] Denied caller retries **Commit plan** repeatedly in the same dialog → every attempt refused, no partial plan, entity or instance rows. — agent-walkable
- [ ] Denied caller drives the hidden Connect anyway: opens the File Upload workflow from a stale tab opened while permitted, uploads, interprets → `/interpret` may succeed (it creates nothing), commit refused. — agent-walkable

### Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §6 removed member + a live user-principal policy attachment | The callback passed the create check and reached the code exchange: `assertCanCreateFromState` re-read roles but not membership, and `SeatService.removeMember` doesn't tombstone user-principal attachments. No API or CLI creates those, so it needed a DB-planted row | low | fixed-in-PR: `assertCanCreateFromState` now requires a live `organization_users` row (403 `MEMBERSHIP_NOT_FOUND`); regression tests in both callback suites |

### Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

### Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org/job/entity ids):
