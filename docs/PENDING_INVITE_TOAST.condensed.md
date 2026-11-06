# Pending-write callbacks survive unmount — Condensed design (#970)

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

## Decision 1 — run per-call callbacks from the request's promise, in the hook

- **A. Fix call sites:** move each toast into the SDK hook's `onSuccess`, or `await mutateAsync` at each site. That's 14 toast sites, plus 51 more that lose invalidations or state updates the same way. It's churn, and the next call site written the usual way brings the bug back.
- **B. Fix the hook (chosen):** `useApiMutation`'s `mutateAsync` and `mutate` stop handing `callOptions` to React Query. They attach `onSuccess` / `onError` / `onSettled` to the request's promise instead, so the callbacks run whether or not the caller is still mounted. Every call site is fixed with no edits, and new ones are correct by default.

**Behaviour preserved:**
- **Order.** The promise settles only after React Query has run the hook-level `onSuccess` / `onError`, including the `onPermissionDenied` invalidation. So per-call callbacks still run after them.
- **Arguments.** Callbacks receive `(data | error, variables, undefined, { client, meta, mutationKey })`. No call site reads the third or fourth argument.
- **Dedupe.** A call dropped by the #751 dedupe still doesn't run its callbacks. Only the call that started the request does.
- **`mutate` never throws.** Rejections are still caught.

**Behaviour that changes:** React Query skips the per-call callbacks of every call except the latest on the same observer. With B, each call that started its own request runs its own callbacks. For example, two different rows deleted quickly in a row now both get their success toast, which is more correct. Identical requests are still deduped.

## Decision 2 — don't block history navigation while a dialog is pending

- **A. A router `useBlocker` while `pending`:** `Modal` lives in `@portalai/core/ui`, which can't import the router, so every form dialog in `apps/web` would need a web-side hook. A blocked browser Back also feels broken: the URL can't change and nothing explains why.
- **B. Let navigation unmount the dialog (chosen):** with Decision 1, a write that succeeds after the user leaves still shows its toast and runs its invalidations. The CLAUDE.md rule is reworded to say what it guarantees: Escape, the backdrop and Close are blocked while pending, and navigating away doesn't lose the outcome of a call whose result is toasted.

Accepted gap: a write that **fails** after the user navigated away shows nothing if the dialog was showing its error in `FormAlert`. Most dialog errors are of that kind. Covering it would mean also toasting errors that a dialog reports inline, which belongs in a separate ticket.

## Plan — 1 slice

**Files**
- Edit `apps/web/src/utils/api.util.ts`. A private `run(variables, callOptions)` returns `{ request, started }`. `mutateAsync` and `mutate` call it and, when `started`, chain `callOptions` onto `request` (`then` for `onSuccess` / `onError`, then `onSettled`). React Query's `mutateAsync` is called without `callOptions`.
- Edit `CLAUDE.md` (Form & Dialog Pattern and API Calls & SDK Helpers): per-call callbacks run even after the caller unmounts, and navigation may unmount a pending dialog.

**Tests**
- New: `apps/web/src/__tests__/auth-mutation-unmount-callbacks.test.tsx`, mirroring `auth-mutation-single-flight.test.tsx`. It covers:
  1. `mutate(v, { onSuccess, onSettled })` runs both after the component unmounts mid-request, and so does `onError` on a failure;
  2. `mutateAsync(v, { onSuccess })` the same;
  3. a deduped duplicate's callbacks don't run;
  4. the hook-level `onSuccess` runs before the per-call one;
  5. two different requests each run their own `onSuccess`.
- Existing tests to re-run: `auth-mutation-single-flight`, `auth-mutation-permission-denied`, `auth-mutation-timeout`, `auth-mutation-no-content`, `dialog-single-flight.integration`, `MembersTab` tests. Run them with `npm run test:unit -- --testPathPattern …` in `apps/web`, plus `type-check` and `lint`.

## Smoke (manual, against your dev stack)

1. As an owner, open Settings → Members, click **Invite member**, enter an email and press **Invite**. Throttle the network in DevTools to Slow 3G, then press browser **Back** right after Invite. When the request finishes, the "Invitation created" toast appears on the page you navigated to. Go back to Members: the invite is listed as pending, with no reload needed.
2. Repeat step 1 without pressing Back. The dialog closes, the toast appears once, and the invite link panel shows.
3. Double-press Invite quickly. One invitation is created and one toast appears (the #751 dedupe still holds).
4. With two pending invitations listed, throttle the network, then press **Resend** on both, one quickly after the other. Each shows its own "New invite link generated" toast. Before the fix, only the second one did.

## Out of scope

- Toasting a dialog's error after its dialog was navigated away (see the gap above).
- A router-level navigation blocker for pending writes.
