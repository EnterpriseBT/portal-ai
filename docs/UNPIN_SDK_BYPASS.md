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
| The endpoint | `apps/web/src/api/portal-results.api.ts:63-67` | `remove: (id) => useAuthMutation<{id}, void>({ url: …, method: "DELETE" })` — **no production callers**; only `__tests__/api/portal-results.api.test.ts` exercises it |
| Correct precedent | same file, `:57-61` (`rename`) | Used properly at `PinnedResultDetail.view.tsx:242` with a single known id |
| Variables-in-URL support | `apps/web/src/utils/api.util.ts:151`, `:200` | `url: string \| ((variables) => string)` — already supported, no helper change needed |
| Invalidation | all three sites | `queryClient.invalidateQueries({ queryKey: queryKeys.portalResults.root })` — correct today, must stay |

## Decision — reshape `remove` to take the id in variables, then use it everywhere

`remove(id)` cannot serve `PortalMessage` (dynamic per-block ids), so either the endpoint changes or a second one is added. Since **`remove` has no production callers** (only its own API test), reshaping it is free — no consumer to migrate.

**Chosen:** `remove: () => useAuthMutation<{ id: string }, { id: string }>({ url: (vars) => …, method: "DELETE" })`, using the `url`-as-function support that `api.util.ts` already has. One endpoint serves both a per-block id and a view's single id. All three call sites then use it and drop `fetchWithAuth`.

Rejected: adding a second `removeById` alongside `remove` — two shapes for one operation, and it would leave the dead one in place.

`rename(id)` keeps its hook-bound-id shape: it has a real caller using it correctly, and changing it is unrelated churn.

**The duplicate handlers collapse.** `handleDelete` and `handleUnpin` in `PinnedResultDetail` become one handler passed to both props. The two props stay — they are distinct affordances (one goes through a confirm dialog) — but they no longer carry duplicated request logic.

**Errors surface as a toast — the deferral this doc originally recorded is now obsolete.** It said failures should wait for #285 to establish the pattern, because there was no app-wide toast to hook into. #285 and #293 have since merged: `useToast()` (`apps/web/src/utils/toast.context.tsx`) is the documented surface for feedback with no form to attach to, and `CLAUDE.md` → "Toast Pattern (apps/web)" makes it the rule — `FormAlert` inside a dialog, a toast everywhere else. Unpin has no dialog, so it is squarely the toast case.

So the ticket's third deliverable ships here after all: a failed unpin raises `toast.error(...)` with a **Retry** action (the pattern's `ToastAction`), and error toasts persist until dismissed, so a failure can't scroll past unseen. That is strictly better than the fallback this doc planned for (an `error` field nobody renders).

## Plan — 1 slice

**Files**

- Edit: `apps/web/src/api/portal-results.api.ts` — reshape `remove` to id-in-variables.
- Edit: `apps/web/src/components/PortalMessage.component.tsx` — `handleUnpin` uses `sdk.portalResults.remove()`; delete the `useAuthFetch` import and destructure; keep the `.root` invalidation and `onPinChange()`; raise `toast.error` with Retry on failure.
- Edit: `apps/web/src/views/PinnedResultDetail.view.tsx` — one handler for both props via the SDK; delete the `useAuthFetch` import and destructure; same toast-on-failure, staying on the view (the result still exists).
- Edit: `apps/web/src/__tests__/api/portal-results.api.test.ts` — `remove` is already covered here (the doc's "no callers" note missed this test); rewrite it for the id-in-variables shape.
- Edit: `apps/web/src/__tests__/PortalMessage.test.tsx` — extend the SDK mock with `portalResults.remove`, add a container describe.
- Edit: `apps/web/src/__tests__/PinnedResultDetail.test.tsx` — add an SDK mock and a container describe; both affordances assert through `remove`.
- New: `apps/web/src/__tests__/sdk-only-api-calls.test.ts` — the convention guard.

**Note on test placement.** Both existing test files render only the pure UI components, per the Component File Policy. The behavior this ticket changes is *container wiring*, so each file gains a container `describe` that renders the implementation component with the SDK mocked — the policy's "exercised through higher-level integration tests where covering the wiring is genuinely the point". The toast API is injected through the real `ToastContext.Provider` rather than by mocking the module, because `test-utils` imports `ToastContext` itself and a module mock would break the harness.

**Tests** (`cd apps/web && npm run test:unit`)

1. Unpinning a pinned block calls the SDK's `remove` mutation with the pinned result's id.
2. It invalidates `queryKeys.portalResults.root` (via `jest.spyOn(queryClient, "invalidateQueries")`, per the house test util) and calls `onPinChange`.
3. Source guard: no `fetchWithAuth` / `useAuthFetch` remains in either file, and both reference `sdk.portalResults.remove()` — asserted over the source, since the convention *is* the deliverable. Scoped to the two files this ticket fixes; widening it needs the sweep ticket.
4. `PinnedResultDetail`'s unpin and delete paths both route through the same SDK mutation.
5. A failed remove raises `toast.error` and does **not** invalidate, navigate, or call `onPinChange` — a failure must not look like a success.
6. The failure toast carries a **Retry** action that re-issues the mutation.
7. Existing pin/unpin rendering tests still pass.

## Smoke (manual, against your dev stack)

> **Walked 2026-07-29 against the local dev stack — successful.** Steps 1, 3–7 passed: session unpin, detail-view Unpin, and the Delete confirm dialog each removed exactly one result with **one** `DELETE` request (the pre-#286 duplicate handlers were the double-request risk), the offline case raised a persistent error toast with the block left pinned, and **Retry** completed the unpin once the network returned. Seven results were pinned across the walk and exactly one — the untouched control — survived.
>
> **Step 2 (data-table block) was deliberately skipped.** The workspace had no entity records after the #295 smoke reset, and unpin is block-type agnostic — the handler only ever sees a `portalResultId` — so the data-table variant exercises no distinct code path. Rebuilding a connector for it was judged disproportionate.

1. `npm run dev`; in a portal session, pin a text block, then click the pin icon again to unpin — the pin state clears and the result disappears from the station's pinned list.
2. Repeat with a data-table block.
3. Open a pinned result's detail view, click **Unpin** — it deletes and navigates back to the pinned-results list.
4. In the same view, use the **Delete** button's confirm dialog — same outcome, no double request (check the Network tab shows exactly one `DELETE`).
5. With devtools offline, click unpin — an error toast appears reading "Could not unpin this result", it **stays until dismissed**, and the block remains pinned. Click **Retry** with the network restored: the unpin goes through.
6. Same in the detail view: go offline, click Unpin — the toast appears and the view stays put (the result still exists), rather than navigating away as though it worked.
7. Pinned results unrelated to the one unpinned are untouched.

## Out of scope

- **Auditing pin-side error handling** — #285 shipped the dialog's `FormAlert`; this ticket only adds the unpin side's toast.
- **Merging the two "Unpin"/"Delete" affordances** in the detail view. They deliberately differ (one confirms), so only the duplicated request logic is removed, not a UX decision.
- **Reshaping `rename`** — it has a correct caller; changing it is unrelated churn.
- **Auditing every other `fetchWithAuth` call site** across `apps/web` for the same violation. Worth its own sweep ticket; this one fixes the portal-results endpoint.
