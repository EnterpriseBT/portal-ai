# Audit-log activity view — Condensed design (#596)

**Issue:** [EnterpriseBT/portal-ai#596](https://github.com/EnterpriseBT/portal-ai/issues/596) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #575 shipped the audit-log store, emission, and an **owner-gated read API** (`GET /api/organization/audit-log`) but no way to *see* the trail in the app. This ticket is the in-app surface #575 deferred: an owner-only **Activity** tab in Settings that renders the current org's audit trail — paginated, newest-first, filterable by action/outcome. Single-package (`apps/web`); it consumes the existing #575 contract and changes nothing server-side.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Read API (owner-gated) | `apps/api/src/routes/organization.router.ts:889` | `GET /audit-log`; 403 `AUDIT_LOG_NOT_AUTHORIZED` when `ownerUserId !== userId` (`:925`) |
| Request/response contract | `packages/core/src/contracts/audit-log.contract.ts:16,27` | query extends pagination + optional `action`/`outcome`; payload `{ entries, total }` |
| Entry model + enums | `packages/core/src/models/audit-log.model.ts:23,41,44` | `AUDIT_ACTIONS` (12 values), `AuditOutcomeSchema` (`success`/`failure`); entry has `created`, `userId`, `action`, `targetType`/`targetId`, `outcome`, `sourceIp`, `userAgent` |
| Settings tabs (read-once) | `views/Settings.view.tsx:44,114`; `utils/routes.util.ts:34,41,51` | `SettingsTab` enum + `SETTINGS_TAB_INDEX` + `settingsTabIndexFromSearch`; billing tab lazy-renders behind `value === 2` (`:338`) |
| Paginated-table analog | `components/UsageLedgerDialog.component.tsx:124,158,166` | `usePagination` (`defaultSortBy:"created"`, `desc`, offset) → `sdk.organizations.usageLedger(queryParams)` → `DataTable` w/ loading/empty |
| SDK read pattern | `api/organizations.api.ts:33`; `api/sdk.ts:30`; `api/keys.ts:31` | `useAuthQuery(queryKeys.…list(params), buildUrl(url, params))`; `list: (params) => [...root,"list",params]` |
| `select` filter → scalar param | `components/PaginationToolbar.component.tsx:75,525` | `SelectFilterConfig` single value serializes to `params[field]=values[0]` — matches the API's scalar `action`/`outcome` |
| Owner predicate (mirror) | `components/SubscriptionBilling.component.tsx:297` | `isOwner = profile.userId === organization.ownerUserId`, from `sdk.auth.profile()` + `sdk.organizations.current()` |
| Query-error render convention | `components/DataResult.component.tsx:48` | views render fetch errors via `DataResult`/`StatusMessage`, not toast; toast is for mutations |

## Decision — surface, filters, error state

- **Tab:** add `SettingsTab.Activity` at index 3, **owner-gated** — `Settings.view.tsx` computes `isOwner` (mirroring `SubscriptionBilling:297`) and conditionally renders the `<Tab>`/`<TabPanel>`; the panel body lazy-renders behind `value === 3` so the query doesn't fire on other tabs. Server already enforces the 403 — the gate is defense-in-depth, not the security boundary.
- **Table:** reuse `usePagination` (offset mode, `defaultSortBy:"created"`, `defaultSortOrder:"desc"`, `limit:20`) + `DataTable`, exactly as `UsageLedgerDialog`. `action` and `outcome` are `SelectFilterConfig` filters seeded from `AUDIT_ACTIONS` / `AuditOutcomeSchema` — they serialize to the API's scalar params for free.
- **Error state:** wrap the query in `DataResult` (fetch error → inline `StatusMessage`), matching the house convention. The ticket's "toast on error" line is satisfied by the established render-not-toast pattern for *query* failures; no local `Snackbar`.
- **Owner→admin widening (#576):** isolate the visibility predicate to one `isOwner` boolean so #576 swaps it to `role in {owner,admin}` in one place — same swap the read API makes.

## Plan — 2 slices

**Slice 1 — SDK + keys + tab enum (plumbing).**
- New: `apps/web/src/api/audit-log.api.ts` — `useAuditLogList` = `useAuthQuery<AuditLogListResponse>(queryKeys.auditLog.list(params), buildUrl("/api/organization/audit-log", params), undefined, options)`.
- Edit: `apps/web/src/api/keys.ts` — add `auditLog: { root, list: (params?: AuditLogListRequestQuery) => [...root,"list",params] }`.
- Edit: `apps/web/src/api/sdk.ts` — expose `auditLog: { list: useAuditLogList }`.
- Edit: `apps/web/src/utils/routes.util.ts` — `SettingsTab.Activity = "activity"` (index 3) + `settingsTabIndexFromSearch` maps it; unknown/invalid → existing default.
- Tests: `apps/web/src/__tests__/routes.util.test.ts` (extend) — `?tab=activity` → 3, unknown → default.

**Slice 2 — the view + owner gate.**
- New: `apps/web/src/components/AuditLogActivity.component.tsx` — container `AuditLogActivity` (wires `sdk.auditLog.list` + `usePagination`, feeds `total` back) + pure `AuditLogActivityUI` (props-only: `entries`, `toolbarProps`, `isLoading`, `error`; renders `DataTable` columns timestamp/actor/action/target/outcome/IP/user-agent, loading + empty + `DataResult` error). Per Component File Policy: UI + its container in one file.
- Edit: `apps/web/src/views/Settings.view.tsx` — compute `isOwner`; add the 4th `<Tab label="Activity">`/`<TabPanel>` (both owner-gated), lazy body behind `value === 3`.
- Tests: `apps/web/src/__tests__/AuditLogActivity.test.tsx` — drive `AuditLogActivityUI` (no SDK mock): renders rows for a fixture entry set; empty state (no entries); loading state (`CircularProgress`); error state (`StatusMessage`). SDK mocked via `jest.unstable_mockModule` only where the container is exercised.
- `npm run test:unit` (web), `npm run type-check`, `npm run lint`.

## Smoke (manual, against your dev stack)
1. As the seeded org **owner**, open `/settings` → an **Activity** tab appears; it lists the org's audit entries newest-first with timestamp, actor, action, target, outcome, IP, user-agent.
2. Trigger an auditable action (e.g. switch orgs, or rotate a toolpack secret) → refresh Activity → the new entry appears at the top.
3. Filter by `action` and by `outcome` → the table narrows to matching rows; paginate (page 2, change page size) → rows change, count is correct.
4. Empty case: an org with no events → empty-state message, not a blank panel. Stop the API and reload the tab → inline error (not a blank panel, no crash).
5. As a **non-owner** member of the org → the Activity tab is not shown; hitting `/settings?tab=activity` does not render the trail, and the read API returns 403.
6. Switch orgs → the trail switches to the newly-active org's entries only.

## Out of scope
- Audit **storage / emission / read API** — #575 (consumed here, unchanged).
- RBAC roles themselves — #576 (this uses the owner predicate #576 later widens).
- CSV/PDF export and real-time streaming of new events — possible follow-ups; the view is a paginated read.
- **Keyset pagination** — the #575 read API is offset-only; offset is acceptable at expected audit volumes. Keyset would require an API change (out of this ticket's single-package scope).
