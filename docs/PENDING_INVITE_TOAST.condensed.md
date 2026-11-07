# Mutation toasts survive navigation — Condensed design (#970)

**Issue:** [EnterpriseBT/portal-ai#970](https://github.com/EnterpriseBT/portal-ai/issues/970) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** React Query runs the callbacks passed to `mutate(vars, { onSuccess, onError, onSettled })` only while the calling component's observer is mounted. If a user presses Back while an invite is in flight, the dialog and `MembersTab` unmount and the request still lands, but its `onSuccess` never runs. So no "Invitation created" toast appears, and the invalidations in that same callback never happen. This is not specific to invites: `apps/web/src` has **65** `mutate(…)` calls that pass per-call callbacks, and **14** of them raise a toast. Every one of them loses its callbacks when the component unmounts first. The fix is in `apps/web` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Invite submit | `components/MembersTab.component.tsx:309-320` | `inviteCreate.mutate(req, { onSuccess: invalidate ×2, setLastInviteUrl, close, toast })` |
| Mutation hook | `utils/api.util.ts:416-524` (`useApiMutation`, behind `useAuthMutation` / `usePublicMutation`) | already wraps `mutateAsync` / `mutate` for the #751 in-flight dedupe; passes `callOptions` straight through to React Query |
| Dedupe | `api.util.ts:495-509` | a duplicate call returns the running promise; its `callOptions` are dropped |
| Toast provider | `providers/Toast.provider.tsx`, mounted in `Application.provider.tsx` above the router | `toast` from `useToast()` keeps working after the caller unmounts |
| Dialog rule | `CLAUDE.md` → Form & Dialog Pattern, "Nothing dismisses a dialog while `pending`" | covers Escape, the backdrop and Close; history navigation unmounts the route |

React Query version: 5.90. Hook-level `mutationOptions.onSuccess` already runs after an unmount, because it's attached to the `Mutation`, not to the observer. `mutateAsync`'s promise also settles after an unmount.

## Decision 1 — the hook owns a call's toast and cache refresh

- **A. Fix call sites:** `await mutateAsync` and toast at each of the 14 toast sites. Nothing stops the next call site written the usual way from bringing the bug back.
- **B. Run every per-call callback from the request's promise (first implementation, reverted in code review):** this fixes every site, but it also runs page-local work on a page the user has left. Pressing Back during Create Portal then navigates the user to the new portal (`Dashboard.view.tsx`), and about 9 "delete then go to the list" handlers do the same. It also drops React Query's latest-call-only rule, so stale results can win, and it moves callbacks ahead of the observer's state update.
- **C. Hook-owned `toast` and `invalidate` options (chosen):** `mutate` / `mutateAsync` take two app-level options next to React Query's callbacks:

  ```ts
  mutate(vars, {
    toast: { success?, successSeverity?, error? },
    invalidate?: QueryKey[] | (data, vars) => QueryKey[],
    onSuccess,  // page-local, mounted-only (React Query's rule, unchanged)
  })
  ```

  `useApiMutation` runs `toast` and `invalidate` from the request's promise through the app-level toast provider and the query client, so both happen whether or not the caller is still mounted. `success` is a string or `(data, vars) => string`. `error` is a `serverErrorMessage` fallback or `(error, vars) => string`; omit it when a dialog shows the error in `FormAlert`. Per-call `onSuccess` / `onError` / `onSettled` keep React Query's semantics: mounted only, latest call only, batched with the hook's state.

**Enforced:** `mutation-toast.guard.test.ts` fails CI on a `toast.*` call inside the options argument of `.mutate(…)` / `.mutateAsync(…)`, or of a call through a name destructured from either. Its allowlist holds one file with a recorded reason: `EntityDetail.view.tsx`. Its clear-records `onSuccess` toasts report the *job* finishing, tracked over the page's own SSE connection, not the request's outcome. The request's own toast is on the option.

**Migrated:** the 14 toast sites plus 4 found by the guard (CuratedViewDetail, CuratedViews, EntityGroupDetail, and the EntityDetail request toast). Each site's invalidations moved to `invalidate`, so a return within the 1-minute `staleTime` isn't stale.

**Behaviour preserved:** a deduped duplicate (#751) reports nothing, and `mutate` never throws.

## Decision 2 — don't block history navigation while a dialog is pending

- **A. A router `useBlocker` while `pending`:** `Modal` lives in `@portalai/core/ui`, which can't import the router, so every form dialog in `apps/web` would need a web-side hook. A blocked browser Back also feels broken: the URL can't change and nothing explains why.
- **B. Let navigation unmount the dialog (chosen):** with Decision 1, a write that succeeds after the user leaves still shows its toast and runs its invalidations, and page-local `onSuccess` work (navigation included) doesn't run. The CLAUDE.md rule is reworded to say what it guarantees: Escape, the backdrop and Close are blocked while pending, and navigating away doesn't lose the outcome of a call whose result is toasted.

Accepted gap: a write that **fails** after the user navigated away shows nothing if the dialog was showing its error in `FormAlert`. Most dialog errors are of that kind. Covering it would mean also toasting errors that a dialog reports inline, which belongs in a separate ticket.

## Plan — 1 slice

**Files**
- `apps/web/src/utils/api.util.ts`: `AppCallOptions` (`toast`, `invalidate`). `mutateAsync` strips them before calling React Query, then attaches them to the request's promise when this call started the request.
- The 18 call sites above, moved onto the options.
- `apps/web/src/__tests__/guard-source.util.ts`: source-parsing helpers extracted from `effect-mutation.guard.test.ts`, shared with the new guard.
- `CLAUDE.md` (API Calls & SDK Helpers, Mutation Cache Invalidation, Form & Dialog Pattern).

**Tests**
- New `auth-mutation-unmount-callbacks.test.tsx` covers:
  - after an unmount, the success toast and invalidation run and `onSuccess` doesn't;
  - after an unmount, the error toast goes through `serverErrorMessage` and nothing is invalidated;
  - message functions and the `info` severity;
  - `onSuccess` still runs while mounted;
  - `mutateAsync` reports the same way;
  - a deduped duplicate raises one toast.
- New `mutation-toast.guard.test.ts` (with self-tests).
- Re-run the existing mutation suites, both guards, and the tests of every migrated component, plus web `type-check` and `lint`.

## Smoke (manual, against your dev stack)

1. As an owner, open Settings → Members, click **Invite member**, enter an email and press **Invite**. Throttle the network in DevTools to Slow 3G, then press browser **Back** right after Invite. When the request finishes, the "Invitation created" toast appears on the page you navigated to. Go back to Members: the invite is listed as pending, with no reload needed.
2. Repeat step 1 without pressing Back. The dialog closes, the toast appears once, and the invite link panel shows.
3. Double-press Invite quickly. One invitation is created and one toast appears (the #751 dedupe still holds).
4. With two pending invitations listed, throttle the network, then press **Resend** on both, one quickly after the other. Each shows its own "New invite link generated" toast.
5. On the Dashboard, throttle the network, create a portal and press browser **Back** right away. You stay where Back took you; the app doesn't jump to the new portal when the request lands.

## Out of scope

- Toasting a dialog's error after its dialog was navigated away (see the gap above).
- A router-level navigation blocker for pending writes.
