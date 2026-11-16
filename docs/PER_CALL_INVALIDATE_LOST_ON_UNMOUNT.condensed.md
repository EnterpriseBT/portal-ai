# Cache refresh survives unmount — Condensed design (#985)

**Issue:** [EnterpriseBT/portal-ai#985](https://github.com/EnterpriseBT/portal-ai/issues/985) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). The ticket's Sizing said `full` but allowed condensed if the work is purely mechanical. It is: `apps/web` only, plus CLAUDE.md wording. It reuses #970's existing `invalidate` option, and the new guard copies the toast guard.

**Why.** React Query runs a per-call `onSuccess` only while the caller is mounted. A cache refresh written there is lost when the page unmounts before the request ends (browser Back, a sidebar link). The write lands, but every other page keeps showing the old data. #970 added `mutate(vars, { invalidate })`, which runs from the request's promise, and moved toasts onto it. Invalidations stayed in `onSuccess`, and CLAUDE.md still allows both. This ticket moves every invalidation onto `invalidate`, makes the option the only allowed form, and adds a guard.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `invalidate` option | `apps/web/src/utils/api.util.ts:336`, run at `:552-563` | `QueryKey[]` or `(data, vars) => QueryKey[]`; runs whether or not the caller is mounted |
| Toast guard | `apps/web/src/__tests__/mutation-toast.guard.test.ts` | scans `.mutate`/`.mutateAsync`/destructured-name calls; flags `toast.*` in the options argument |
| Shared parser | `apps/web/src/__tests__/guard-source.util.ts` | `blankLiterals`, `argumentsAt`, `topLevelArgs`, `sourceFiles` |
| Delete helpers | `apps/web/src/utils/delete-invalidation.util.ts:11,30` | take a `QueryClient` and invalidate. Called only from `onSuccess` (Connector, ConnectorInstance, Entities, EntityDetail) |
| Inline offenders | 39 calls in 18 files by the first scan; the finished guard, which also follows local `invalidate()` helpers (Tags, EntityGroups, EntityGroupDetail, Stations, Toolpacks, ShareDialog, GroupEditorDialog), found ~50 in 22 | CuratedViewEditorDialog 2, OrgSwitcher 1, use-connector-instance-sync 1, ColumnDefinitionDetail 5, ColumnDefinitionList 2, Connector 1, ConnectorInstance 4, Dashboard 2, Entities 2, EntityDetail 5, EntityRecordDetail 3, PinnedResultDetail 1, Portal 2, Settings 1, StationDetail 3, Stations 2, Toolpacks 1, SandboxConnectorWorkflow 1 |
| By-reference offenders | `onSuccess: invalidate` / `invalidateTags` | ShareDialog `:369`, Toolpacks `:477,:536`, EntityDetail `:807,:814`, EntityGroupDetail `:499`. The ticket's count (28) missed these, the delete helpers, and three files |
| Recorded exception | EntityDetail `handleClearRecords` `:752` | the `.finally` invalidations follow the clear *job* over the page's own SSE connection, not the request. It's already on the toast guard's allowlist for the same reason |
| Tests faking `mutate` | `__tests__/cache-invalidation.test.tsx`, `PortalView.gates`, `SettingsRename`, `PinnedResultDetail` | the fakes call `onSuccess` and spy on `invalidateQueries`; they'll assert the `invalidate` option instead |

## Decision — every invalidation goes through `invalidate`, enforced by a sibling guard

- **Call sites.** Each call's keys move to `invalidate: [...]`. Use the function form when a key depends on the response or the variables. Page-local work (closing a dialog, `reset()`, `navigate`, local state) stays in `onSuccess`. An `onSuccess` left empty is deleted.
- **Delete helpers return keys and no longer invalidate.** They become `connectorInstanceDeleteKeys()` / `connectorEntityDeleteKeys()`, which return `QueryKey[]` and are used as `invalidate: connectorEntityDeleteKeys()`. The old `QueryClient` functions are deleted, with no alias.
- **OrgSwitcher** uses `invalidate: [[]]`, with a comment: an empty prefix matches every query, the same as today's bare `invalidateQueries()`. The comment on `organizations.api.ts:57` that says "consumers own invalidation in a per-call onSuccess" is rewritten.
- **Guard.** A new `mutation-invalidate.guard.test.ts` fails on `invalidateQueries(` inside a mutation call's options argument. It also resolves an identifier the options name (such as `onSuccess: invalidateTags`) to a function, `useCallback` or arrow function declared in the same file, and checks that function's body. The call-scanning loop moves into `guard-source.util.ts` as `mutationCallOptions(source)`, so the toast guard and the new guard share one parser. The allowlist is **counted per file with a reason**: `EntityDetail.view.tsx: 1`, the clear-records job follow-up. A per-file allowlist would hide the other EntityDetail sites. The "only shrinks" test asserts that each allowlisted file has exactly its count.
- **What the guard allows:** an invalidation after `await mutateAsync(…)` or in `.then` on it, because a promise continuation runs whether or not the caller is mounted. Same rule as toasts.
- **Convention.** CLAUDE.md "Mutation Cache Invalidation", first bullet, becomes "through the call's `invalidate` option (#985), never a per-call `onSuccess`", and names the guard. "API Calls & SDK Helpers" (#970 bullet) adds the guard beside `mutation-toast.guard.test.ts`.

Rejected: extending the toast guard file itself. One guard per rule keeps each failure message pointed at its own convention. A hook-level `invalidate` on the SDK definition was also rejected: several endpoints' keys depend on the call site (`StationDetail` vs `Stations`), and #970 already settled on the per-call option.

## Plan — 2 slices

**Slice 1 — migrate every call site** (`fix(web): cache refresh survives unmount via invalidate (#985)`)
- **Files:** `utils/delete-invalidation.util.ts` and the 20 files above; `api/organizations.api.ts` (comment only).
- **Tests:** update `__tests__/cache-invalidation.test.tsx`, `PortalView.gates.test.tsx`, `SettingsRename.test.tsx`, `PinnedResultDetail.test.tsx`, and any other fake that asserts invalidation through `onSuccess`, to assert `expect.objectContaining({ invalidate: [...] })` on the mocked `mutate`. `auth-mutation-unmount-callbacks.test.tsx` already shows that `invalidate` runs after unmount. Add a unit test for the key-list helpers.
- Run: `npm run test:unit -- --testPathPattern '<touched files>'` and `npm run type-check` (web).

**Slice 2 — guard + convention** (`test(web): guard invalidation in per-call callbacks (#985)`)
- **Files:** `__tests__/guard-source.util.ts` (`mutationCallOptions`), `__tests__/mutation-toast.guard.test.ts` (use it), new `__tests__/mutation-invalidate.guard.test.ts`, `CLAUDE.md`.
- **Tests:** the guard's self-tests cover inline `onSuccess`/`onSettled`, a destructured name, and a by-reference same-file function (all flagged). They also cover `invalidate: [...]`, an invalidation after `await mutateAsync`, an unrelated `save(v, {...})`, and the string `"invalidateQueries("` (all allowed). There's a non-vacuous check (≥ 20 `invalidate:` uses in the app) and the counted allowlist. Write it red against slice 1's parent (temporarily) to confirm it catches the real tree. Then `npm run lint`, `npm run format:check`.

## Smoke (manual, against your dev stack)

1. **The repro.** Dashboard → open a portal → DevTools Network: Slow 3G → **Rename** → new name → **Save** → browser **Back** at once. After the PATCH finishes, the dashboard's Recent Portals shows the new name with no reload.
2. **Delete then navigate.** Entity detail → **Delete** → confirm. You land on `/entities` without the deleted entity, and its station's views no longer list its curated views.
3. **Tag by reference.** Entity detail → assign a tag, throttle, navigate to Entities mid-request → back to the entity: the tag shows.
4. **Org switch.** Switch org from the sidebar menu. The dashboard, stations and connectors show the new org's data with no reload.
5. **Clear records (the exception).** Entity detail → Clear records → stay on the page. You get the "Deleted N records" toast and the record count drops to 0.

## Out of scope

- The clear-records job follow-up surviving unmount. It's tracked over the page's own SSE connection, and moving it above the page is the job-feedback design, not this bug.
- Hook-level `onSuccess` in `api/members.api.ts`, `invitations.api.ts` and `organizations.api.ts`. React Query runs those on the mutation itself, so they survive unmount already.
