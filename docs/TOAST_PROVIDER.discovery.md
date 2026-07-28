# Shared toast provider — Discovery

**Issue:** [EnterpriseBT/portal-ai#293](https://github.com/EnterpriseBT/portal-ai/issues/293)

> **Amended 2026-07-28, while writing the spec.** Three things this document got wrong, all corrected in `docs/TOAST_PROVIDER.spec.md`: (1) there are **five** ad-hoc Snackbars, not six — `ConnectorInstance.view.tsx` renders `ConnectorInstanceSyncFeedbackUI` and the counted match was a comment, so **three** sites migrate, not four; (2) placement is **bottom-right**, not bottom-center — the two best-built implementations were already bottom-right, and keeping toasts off bottom-center leaves `UpdateBanner` (a holdout) its own space; (3) open question 5 assumed `Toolpacks`' toast `data-testid` had test consumers — nothing asserts on it, so there is no constraint to preserve.

**Why this exists.** `apps/web` has five independent `Snackbar` implementations and no way for a component to raise a toast. Each site re-invents placement, auto-hide timing, dismiss semantics and open/close state, and they already disagree — `Settings` hides after 8s, `Toolpacks` hides after 4s on success but *never* on error and blocks clickaway dismissal, `UpdateBanner` never auto-hides at all. A seventh consumer is now blocked: #286 must surface an unpin failure, which is an icon click with no dialog, so `FormAlert` — the pattern #285 established for in-dialog errors — has nowhere to render.

This is the surface that lets any component report an outcome that has no form to attach to. It is filed with named callers rather than as speculative infrastructure: #286 is the immediate consumer, and the existing sites are the retrofit set.

## The current shape

### The ad-hoc implementations

| Surface | Location | Behavior today |
|---|---|---|
| Toolpacks refresh | `apps/web/src/views/Toolpacks.view.tsx:366`, `:540-560` | `useState<RefreshToast \| null>`; 4s auto-hide on success, `null` (never) on error; suppresses `clickaway` dismissal for errors; `data-testid` per severity |
| Settings billing | `apps/web/src/views/Settings.view.tsx:344` | 8s auto-hide, bottom-center, severity from state |
| App update | `apps/web/src/components/UpdateBanner.component.tsx:20-46` | Bottom-center, no auto-hide, `severity="info"`, `Alert` with **Dismiss / Reload action buttons** |
| Connector sync | `apps/web/src/components/ConnectorInstanceSyncFeedback.component.tsx:130` | Three-phase sync feedback inside one Snackbar |
| Layout plan edit | `apps/web/src/views/EditLayoutPlan.view.tsx:239` | Own instance |
| ~~Connector instance~~ | `apps/web/src/views/ConnectorInstance.view.tsx` | **Miscounted** — no Snackbar of its own; renders `ConnectorInstanceSyncFeedbackUI` (`:46`, `:737`). The match was a comment at `:730`. |

**Toolpacks is the most considered of them** — errors that persist until dismissed, successes that fade — and it is the behavior the others should have inherited. **`UpdateBanner` is already the target shape**: bottom-center, MUI `Alert` with an `action`, mounted at the app root. Between them the intended design is already written, twice, by hand.

### Where a provider would mount

| Piece | Location | Note |
|---|---|---|
| App root | `apps/web/src/Application.tsx:9-16` | `<ApplicationProvider>` wraps `<RouterProvider>`; **`<UpdateBanner />` is already a root-level sibling of the router** — the precedent for root-mounted ephemeral UI |
| Provider chain | `apps/web/src/providers/Application.provider.tsx:37-59` | `StrictMode` → `Auth0Provider` → `ThemeProvider` → `LayoutProvider` → `QueryClientProvider` → children |
| Context precedent | `apps/web/src/utils/scroll-root.context.tsx:1-15` | The house shape for a context + `useX()` hook, with a documented null fallback for Storybook/tests |

Two constraints fall out of this: the provider must sit **inside `ThemeProvider`** (toasts are MUI-themed) and **outside `RouterProvider`** (so a toast survives navigation — a resolved requirement). `StrictMode` is on, so any queue state must tolerate double-invoked renders.

### The consumer that justifies it

`sdk.portalResults.remove` (`apps/web/src/api/portal-results.api.ts:63-67`) is unused and hand-rolled at three call sites; #286 converts them and needs a failure surface. Its design doc is written and parked on `chore/unpin-sdk-bypass`.

## The design space

### Decision 1 — The raise API

**A. `useToast()` returning an imperative function** — `const toast = useToast(); toast.error("Couldn't unpin", { action })`.
**B. A single `show(options)` function** — `toast({ message, severity, action })`.
**C. Declarative** — components render a `<Toast>` element when they want one.

| | A — severity methods | B — single `show` | C — declarative |
|---|---|---|---|
| Call-site brevity | `toast.error(msg)` | `toast({ message, severity: "error" })` | JSX + local state |
| Discoverability | Methods enumerate the severities | One signature to learn | — |
| Fits "raise from a handler" | Yes | Yes | **No** — needs local state, which is the problem being removed |
| Extending with new options | Per-method options bag | One options bag | — |

**Lean: A, implemented over B.** `toast.error(...)` / `toast.success(...)` read well at the call site and make the severity set self-documenting, while each delegates to one internal `show`. C is the shape being deleted — every existing site already holds its own open/close state.

### Decision 2 — Where the queue lives

**A. Provider-owned `useState` queue** — array of toasts; the host renders the head.
**B. A module-level store** (subscribe/emit) with a thin hook.
**C. `notistack`** — the ecosystem default.

| | A — provider state | B — module store | C — notistack |
|---|---|---|---|
| New dependency | No | No | **Yes** |
| Raise from outside React | No | Yes | Partly |
| StrictMode double-render safety | Needs care (keyed ids) | Isolated from render | Library's problem |
| Matches house patterns | Yes (`scroll-root.context`) | No precedent | No precedent |
| Control over queue policy | Full | Full | Library's model |

**Lean: A.** The repo has a context+hook precedent and no store precedent, the resolved policy (bounded stack with a count, asymmetric per-severity timing, bottom-right, persists across routes, optional action) is specific enough that a library's model would have to be bent to fit, and adding a dependency for ~80 lines of queue is poor value. B's advantage — raising a toast from non-React code — has no caller today; **that is exactly the speculative-infra trap**, so it stays unbuilt until something needs it.

### Decision 3 — Concurrency, given that errors persist and non-errors don't

The timing rule is asymmetric by design (Toolpacks' behavior, adopted as default): **`error` persists until dismissed; `success` / `info` / `warning` auto-hide.** That asymmetry is what makes concurrency a real decision — an undismissed error is a long-lived occupant, not a passing one.

**A. Strict queue, one visible.** Later toasts wait, however long the error sits there.
**B. Stack all pending.** Every toast visible simultaneously.
**C. Stack up to 3, with a "+N more" indicator beyond that.** Independent timers per toast; dismissal is per-toast, and the count row carries a **Dismiss all**.

| | A — strict queue | B — stack all | C — stack 3 + count |
|---|---|---|---|
| Error + success arrive together | **Success hidden** behind the error, possibly for minutes | Both visible | Both visible |
| Retry loop yields 6 errors | One visible, rest invisible — user unaware | **A wall of 6** to dismiss individually | 3 visible + "+3 more" |
| User knows more exist | **No** | Implicitly (they are all there) | Explicitly |
| Host complexity | One `Alert` | N `Alert`s, N timers | N ≤ 3 `Alert`s, N timers, a count row + Dismiss all |
| Escaping a pile | Dismiss one at a time | Dismiss one at a time | **One click clears everything** |
| Screen budget at the anchor | Minimal | Unbounded | Bounded |

**Lean: C.** A's failure is the sharp one — the asymmetric timing means a persistent error can hide a success indefinitely, and the user has no signal anything is queued. B removes that but replaces it with an unbounded pile, which is how a retry loop turns feedback into an obstacle. C keeps "one thing to read at a time" approximately true while making multiplicity visible and bounding the screen cost. Each toast keeps its own timer, so a success can fade out from under a persistent error sitting beside it.

**This supersedes the "queue, one at a time" answer given when #293 was filed** — the issue body is amended to match, since the asymmetric persistence rule makes strict queueing worse than it looked in the abstract.

### Decision 4 — Which existing sites migrate

**A. Migrate the four "outcome of an action" sites; leave two bespoke.** `Toolpacks`, `Settings`, `EditLayoutPlan`, `ConnectorInstance` are all "an action finished, tell the user" — exactly the provider's job. `UpdateBanner` (driven by version polling, not an action, and permanently visible until acted on) and `ConnectorInstanceSyncFeedback` (a three-phase progress surface, not an outcome) are different animals.
**B. Migrate every existing site** for uniformity.
**C. Migrate only the new consumer** (#286) and leave every existing site.

**Lean: A**, on a principle worth stating as the rule rather than as case-by-case judgements: **polling and progress are not toast surfaces.** A toast reports the *outcome of an action the user just took*. `UpdateBanner` reports a condition discovered by version polling — no action, no outcome, and it must stay until acted on. `ConnectorInstanceSyncFeedback` reports *progress through phases*, which is a status display that happens to be rendered in a Snackbar. Migrating either would mean widening the toast API to cover interaction shapes it is not for — the "migrate for uniformity" move that produces a worse abstraction. C leaves the divergence this ticket exists to remove and leaves the seventh implementation as the only correct one.

The two holdouts get the reason recorded in-file, so the next reader sees a decision rather than an oversight.

### Decision 5 — Where the code lives

**A. `apps/web`** — `utils/toast.context.tsx` + a `ToastHost` component, mirroring `scroll-root.context.tsx`.
**B. `packages/core/ui`** — alongside `Modal`, `Button`, `Alert`.

**Lean: A.** Core's UI package holds presentational primitives; this is app-level infrastructure with app-level policy (queue, routing persistence) and only one consumer app. If a second app ever needs it, the pure `ToastHost` presentation can move to core then, which is cheaper than guessing now.

## Tradeoff comparison

|  | D1: `useToast()` methods | D2: provider state | D3: strict queue | D4: migrate four | D5: `apps/web` |
|---|---|---|---|---|---|
| Spread to spec | Yes — the hook signature | Yes — queue shape + ids | Yes — the stated consequence | Yes — per-site list | Yes — file paths |
| New dependency | No | No | No | No | No |
| Touches `packages/core` | No | No | No | No | No |
| Deletes existing code | — | — | — | **Yes** — four local Snackbars + their state | — |

## Recommendation

1. `apps/web/src/utils/toast.context.tsx` — context + `useToast()` returning `{ success, info, warning, error, show }`, mirroring `scroll-root.context.tsx`'s shape including a documented no-provider fallback for Storybook and tests.
2. A `ToastProvider` that owns a keyed queue in `useState` and renders a `ToastHost` (pure UI). **One `Snackbar` containing a `Stack` of `Alert`s** — MUI `Snackbar`s position absolutely and overlap if several are mounted, so stacking means one positioned container with N children, not N Snackbars.
3. Mount it **inside `ThemeProvider` and outside `RouterProvider`** — as a wrapper in `Application.provider.tsx` — so toasts are themed and survive navigation.
4. Anchor **bottom-right** (revised from bottom-center while writing the spec — see the note below).
5. Default timing follows Toolpacks and is **asymmetric by severity**: `error` persists until dismissed; `success` / `info` / `warning` auto-hide (~4s success, ~6s info/warning — pin the numbers in the spec). Each toast runs its own timer, so a success can fade from beside a persistent error.
6. **Stack up to 3 visible, with a "+N more" indicator when the queue is deeper.** Dismissal is per-toast. Newest nearest the screen edge (pin the order in the spec).
7. **The "+N more" row carries a "Dismiss all"**, shown only while that row is visible (i.e. only past 3 queued). It clears the visible stack *and* the pending queue in one click. This is explicit user intent, which is precisely what the never-auto-dismiss-an-error rule leaves room for — the prohibition is on the *system* discarding an unread error, not on the user choosing to.
8. Optional `action: { label, onClick }`, rendered in the `Alert`'s action slot as `UpdateBanner` already does. Dismiss is always available.
9. Migrate `Toolpacks`, `Settings`, `EditLayoutPlan` and `ConnectorInstance`; leave `UpdateBanner` and `ConnectorInstanceSyncFeedback` bespoke with the reason recorded in each file.
10. #286 raises `toast.error("Couldn't unpin that result", { action: { label: "Retry", onClick: retry } })` — the first consumer of the action affordance.
11. Document the pattern in `CLAUDE.md` beside "Form & Dialog Pattern": **in-dialog failures use `FormAlert`; failures with no form use `useToast`.** That sentence is what stops a seventh Snackbar.

## Open questions

1. **Does a toast raised during an unmount survive?** #286's `PinnedResultDetail` deletes then navigates; the raise happens before the route change, but React may unmount the caller as the toast is queued. **Lean: yes, because the queue lives in the provider above the router — the raising component's lifetime is irrelevant once the toast is enqueued.** Worth an explicit test, since it is the exact case the persistence decision was made for.
2. **Does "Dismiss all" clear pending toasts the user never saw?** Yes by construction — that is the point of the affordance, and it is why the count must be visible before it is offered (you cannot knowingly clear a pile you were not told about). **Lean: clear everything, and do NOT offer an expand-the-stack affordance** — expanding re-creates the unbounded pile that bounding at 3 exists to prevent, while "Dismiss all" resolves it in one click. The invariant that still holds: the *system* never auto-dismisses an error to make room.
3. **Should duplicate toasts collapse?** Clicking unpin twice on a dead API queues two identical errors. **Lean: dedupe consecutive identical (message, severity) pairs while the first is still visible** — cheap, and it prevents the most likely way a user generates a pile. State the key explicitly so it is testable.
4. **Does `StrictMode`'s double-invoked render double-raise a toast?** Raises happen in event handlers, not render, so no — but the queue's id generation must not rely on render-time counters. **Lean: generate ids with `crypto.randomUUID()` at raise time**, matching the sandbox bridge's nonce approach.
5. **Do the four migrations change any existing test?** `Toolpacks` asserts `data-testid="toolpack-refresh-toast-${severity}"`. **Lean: preserve a per-severity test id on the host** so those tests keep their meaning rather than being rewritten around a new selector.

## Enterprise-scale considerations

- **Concurrency & correctness** — **Lean: the queue is the correctness surface.** Two mutations resolving together must both be reported; that is decision 3 plus the dedupe rule in open question 3. No server state, no races beyond React's own.
- **Accuracy & auditability** — **Lean: toasts are explicitly ephemeral and must not be the only record of a failure.** A pin failure is also visible in the dialog (#285) and a data-mutation failure remains inspectable in its view; a toast is the *notification*, never the audit trail. Notification history is out of scope, so nothing here should tempt a caller into using a toast as the sole report of something consequential.
- **Failure modes** — **Lean: fail-open and silent.** If no provider is mounted (Storybook, a unit test), `useToast()` returns no-op functions rather than throwing — a missing toast must never break the feature that raised it. This mirrors `useScrollRoot`'s documented null fallback.
- **Scale & unbounded growth** — **Lean: bound the queue.** A retry loop or a fan-out failure could enqueue hundreds. Cap the queue (e.g. 20) and drop oldest *pending* — never the visible one — and let the dedupe rule absorb the common case. An unbounded array behind a persistent error is the one way this leaks.
- **Multi-tenancy** — `N/A because` toasts are per-browser-session UI with no tenant scope; nothing is shared or persisted.
- **Contract stability** — **Lean: the options bag is the extension point.** `show({ message, severity, action })` grows by adding optional keys, so future needs (a duration override, a "don't dedupe" flag, an id for programmatic dismissal) do not re-plumb the nine call sites. Severity methods are sugar over that one function for the same reason.
- **Data lifecycle** — `N/A because` nothing is persisted; a page reload clears all toasts by design.

## What this doesn't decide

- **Replacing `FormAlert`.** In-dialog errors stay in the dialog; #285 standardized that. The `CLAUDE.md` entry in recommendation 9 is the rule that keeps the two surfaces distinct.
- **Notification history / a notification center.** Toasts are ephemeral; persistence is a separate feature with storage and read-state questions.
- **Job-progress feedback.** `bulk-job-progress` blocks and the SSE surfaces stay as they are. Job *trigger* feedback may become a consumer later.
- **Raising toasts from outside React**, or server-driven / cross-tab toasts. No caller today — decision 2 keeps the door open without building it.
- **Migrating `UpdateBanner` or `ConnectorInstanceSyncFeedback`** — both are different interaction shapes, per decision 4.

## Next step

`docs/TOAST_PROVIDER.spec.md` pins the contract: the `useToast()` signature and its severity methods, the `show` options bag, the queue's shape and id generation, the exact auto-hide durations per severity, the dedupe key, the queue cap, the no-provider fallback, the mount point in the provider chain, and the per-severity test id the `Toolpacks` migration depends on. `docs/TOAST_PROVIDER.plan.md` then slices it — roughly: (1) context + provider + host with the queue, fully tested in isolation; (2) mount it in the provider chain, no consumers yet; (3) migrate `Toolpacks` (the richest behavior, and the one with existing test ids to preserve); (4) migrate the remaining three; (5) the `CLAUDE.md` convention entry plus recorded reasons in the two holdout files. #286 then consumes it on its own branch.
