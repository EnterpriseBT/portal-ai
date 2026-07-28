# Unpin via the SDK — Condensed design (#286)

**Issue:** [EnterpriseBT/portal-ai#286](https://github.com/EnterpriseBT/portal-ai/issues/286) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Unpinning a portal result calls `fetchWithAuth` directly from a component, violating `CLAUDE.md` → "API Calls & SDK Helpers (apps/web)": *"No component — view, workflow, module, or primitive — may call `fetch`, `useAuthFetch`, or `fetchWithAuth` directly."* The bypass costs the mutation's `error`/`isPending` state (so a failed unpin is silent and the button can't disable itself) and its uniform auth-error handling. Single package: `apps/web`.

**The survey found more than the ticket describes.** Three findings that change the shape of the work:

1. **Three call sites, not one.** `PinnedResultDetail.view.tsx` hand-rolls the same DELETE twice more.
2. **Two of them are byte-identical.** `handleDelete` (`:259-268`) and `handleUnpin` (`:270-279`) have the same body — same request, same invalidation, same navigate — wired to two different buttons ("Unpin" at `:117`, and a confirm-dialog "Delete" at `:216`). One operation, two names, duplicated.
3. **`sdk.portalResults.remove` is unused *and* shaped wrong for the main call site.** It binds the id at hook-creation time (`remove: (id) => useAuthMutation(...)`), but `PortalMessage` renders many blocks whose pinned ids differ, so the id is only known at click time. That is why all three call sites hand-rolled it — the endpoint as written could not serve them.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Bypass 1 — portal session | `apps/web/src/components/PortalMessage.component.tsx:319`, `:336-344` | `useAuthFetch` destructure + `handleUnpin`; the file's only use of it |
| Bypass 2 — pinned detail | `apps/web/src/views/PinnedResultDetail.view.tsx:240`, `:259-268` | `handleDelete` |
| Bypass 3 — pinned detail | same file, `:270-279` | `handleUnpin` — **identical body to bypass 2** |
| The endpoint | `apps/web/src/api/portal-results.api.ts:63-67` | `remove: (id) => useAuthMutation<{id}, void>({ url: …, method: "DELETE" })` — **no callers anywhere** |
| Correct precedent | same file, `:57-61` (`rename`) | Used properly at `PinnedResultDetail.view.tsx:242` with a single known id |
| Variables-in-URL support | `apps/web/src/utils/api.util.ts:151`, `:200` | `url: string \| ((variables) => string)` — already supported, no helper change needed |
| Invalidation | all three sites | `queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root })` — correct today, must stay |

## Decision — reshape `remove` to take the id in variables, then use it everywhere

`remove(id)` cannot serve `PortalMessage` (dynamic per-block ids), so either the endpoint changes or a second one is added. Since **`remove` has no callers**, reshaping it is free — no consumer to migrate.

**Chosen:** `remove: () => useAuthMutation<{ id: string }, { id: string }>({ url: (vars) => …, method: "DELETE" })`, using the `url`-as-function support that `api.util.ts` already has. One endpoint serves both a per-block id and a view's single id. All three call sites then use it and drop `fetchWithAuth`.

Rejected: adding a second `removeById` alongside `remove` — two shapes for one operation, and it would leave the dead one in place.

`rename(id)` keeps its hook-bound-id shape: it has a real caller using it correctly, and changing it is unrelated churn.

**The duplicate handlers collapse.** `handleDelete` and `handleUnpin` in `PinnedResultDetail` become one handler passed to both props. The two props stay — they are distinct affordances (one goes through a confirm dialog) — but they no longer carry duplicated request logic.

**Error surfacing is deliberately left to #285.** The ticket's third deliverable says failures should surface "consistent with whatever the pin dialog lands on", and #285 is what establishes that pattern. There is no app-wide toast to hook into (the nearest precedent is a per-feature MUI `Snackbar` in `ConnectorInstanceSyncFeedback.component.tsx:130`), so inventing one here means building a mechanism #285 would then replace. What this ticket *does* deliver is that the error stops being unreachable: the mutation exposes `error` and `isPending` instead of an un-awaited promise that rejects into nothing.

## Plan — 1 slice

**Files**

- Edit: `apps/web/src/api/portal-results.api.ts` — reshape `remove` to id-in-variables.
- Edit: `apps/web/src/components/PortalMessage.component.tsx` — `handleUnpin` uses `sdk.portalResults.remove()`; delete the `useAuthFetch` import and destructure; keep the `.root` invalidation and `onPinChange()`.
- Edit: `apps/web/src/views/PinnedResultDetail.view.tsx` — one handler for both props via the SDK; delete the `useAuthFetch` import and destructure.
- Edit: `apps/web/src/__tests__/PortalMessage.test.tsx` — extend the SDK mock with `portalResults.remove`.
- Edit: `apps/web/src/__tests__/PinnedResultDetail.test.tsx` — exists; extend its SDK mock and assert both paths route through `remove`.

**Tests** (`cd apps/web && npm run test:unit`)

1. Unpinning a pinned block calls the SDK's `remove` mutation with the pinned result's id.
2. It invalidates `queryKeys.portalResults.root` (via `jest.spyOn(queryClient, "invalidateQueries")`, per the house test util) and calls `onPinChange`.
3. `grep` guard: no `fetchWithAuth` / `useAuthFetch` remains in either file — asserted as a test over the source, since this is the actual convention being fixed.
4. `PinnedResultDetail`'s unpin and delete paths both route through the same SDK mutation.
5. Existing pin/unpin rendering tests still pass.

## Smoke (manual, against your dev stack)

1. `npm run dev`; in a portal session, pin a text block, then click the pin icon again to unpin — the pin state clears and the result disappears from the station's pinned list.
2. Repeat with a data-table block.
3. Open a pinned result's detail view, click **Unpin** — it deletes and navigates back to the pinned-results list.
4. In the same view, use the **Delete** button's confirm dialog — same outcome, no double request (check the Network tab shows exactly one `DELETE`).
5. With devtools Network throttled/offline, click unpin — the app does not crash and no unhandled promise rejection appears in the console (the failure is still not *displayed* — that is #285).
6. Pinned results unrelated to the one unpinned are untouched.

## Out of scope

- **Displaying unpin/pin failures to the user** — #285 owns the pattern; see the decision above.
- **Merging the two "Unpin"/"Delete" affordances** in the detail view. They deliberately differ (one confirms), so only the duplicated request logic is removed, not a UX decision.
- **Reshaping `rename`** — it has a correct caller; changing it is unrelated churn.
- **Auditing every other `fetchWithAuth` call site** across `apps/web` for the same violation. Worth its own sweep ticket; this one fixes the portal-results endpoint.
