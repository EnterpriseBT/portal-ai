# Shared toast provider — Spec

Pins the toast contract: the `useToast()` API, the queue's policy (bounded stack, per-severity timing, count row with Dismiss all), the mount point, and which existing Snackbars migrate.

**Issue:** [EnterpriseBT/portal-ai#293](https://github.com/EnterpriseBT/portal-ai/issues/293) · **Discovery:** [`docs/TOAST_PROVIDER.discovery.md`](./TOAST_PROVIDER.discovery.md)

## Key decisions (flag for review)

1. **`useToast()` returns severity methods over one internal `show`** — `toast.error(msg, { action })`. No local open/close state at any call site.
2. **Queue lives in the provider (`useState`), no new dependency.** A module-level store would allow raising from non-React code; no caller needs that, so it stays unbuilt.
3. **Timing is asymmetric by severity:** `error` never auto-hides; `success` 4s; `info` / `warning` 6s. Each visible toast runs its own timer.
4. **Bounded stack:** up to 3 visible; beyond that a count row reads `+N more` and carries **Dismiss all**, which clears visible *and* pending. The **system** never auto-dismisses an error to make room; only the user may discard an unread one.
5. **Mounted inside `ThemeProvider`, outside `RouterProvider`** — toasts are themed and survive navigation.
6. **Polling and progress are not toast surfaces.** `UpdateBanner` (polled condition, no action behind it) and `ConnectorInstanceSyncFeedback` (phase progress) stay bespoke with the reason recorded in-file.
7. **Fail-open:** with no provider mounted, `useToast()` returns no-ops rather than throwing. A missing toast must never break the feature raising it.

### Two corrections to the discovery doc

Found while pinning signatures; both change the work:

- **There are five ad-hoc `Snackbar`s, not six.** `views/ConnectorInstance.view.tsx` has no Snackbar of its own — the match discovery counted is a *comment* at `:730`, and the view renders `ConnectorInstanceSyncFeedbackUI` (`:46`, `:737`). So the migration set is **three** (`Toolpacks`, `Settings`, `EditLayoutPlan`), not four. The issue title says "six" and should be corrected.
- **Placement is bottom-RIGHT, revised from discovery's bottom-center.** Placement splits 2:2 today: `Settings:348` and `UpdateBanner:24` are bottom-**center**, while `Toolpacks:550` and `EditLayoutPlan:248` — the two most considered implementations — are bottom-**right**. Discovery justified bottom-center on the Settings/UpdateBanner match without checking the other two. Bottom-right is now the decision, and it is the better one for a second reason discovery missed: **`UpdateBanner` stays bottom-center as a holdout**, so anchoring toasts bottom-right keeps the app-update banner and transient toasts from occupying the same space. Consequence: two of the three migrations (`Toolpacks`, `EditLayoutPlan`) become visual no-ops, and only `Settings` moves.
- **Discovery's open question 5 rested on a false premise.** `Toolpacks:558` defines `data-testid={\`toolpack-refresh-toast-${severity}\`}` but **nothing asserts on it** — no test in `apps/web/src` references it. There is no existing test to preserve; the host defines its own test ids fresh.

## Scope

### In scope

- `useToast()` + `ToastProvider` + `ToastHost`, with the queue policy above.
- Mounting the provider in the app's provider chain.
- Migrating `Toolpacks`, `Settings` and `EditLayoutPlan` off their local Snackbars.
- Recorded in-file reasons on the two holdouts.
- A `CLAUDE.md` convention entry: in-dialog failures use `FormAlert`; failures with no form use `useToast`.

### Out of scope

- Replacing `FormAlert` (#285 standardized in-dialog errors).
- Notification history / a notification center; server-driven or cross-tab toasts.
- Raising toasts from outside React (no caller).
- Migrating `UpdateBanner` or `ConnectorInstanceSyncFeedback`.
- #286's consumption of the API — it lands on its own branch once this exists.

## Surface

### `apps/web/src/utils/toast.context.tsx` (new)

Mirrors `scroll-root.context.tsx`'s shape: context + hook + documented no-provider fallback.

```ts
export type ToastSeverity = "success" | "info" | "warning" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  action?: ToastAction;
}

/** A queued toast. `id` is assigned at raise time. */
export interface Toast {
  id: string;
  message: string;
  severity: ToastSeverity;
  action?: ToastAction;
}

export interface ToastApi {
  success(message: string, options?: ToastOptions): void;
  info(message: string, options?: ToastOptions): void;
  warning(message: string, options?: ToastOptions): void;
  error(message: string, options?: ToastOptions): void;
  /** The one primitive the four severity methods delegate to. */
  show(toast: Omit<Toast, "id">): void;
  dismiss(id: string): void;
  dismissAll(): void;
}

/** `null` ⇒ no provider (Storybook, unit tests) — `useToast` no-ops. */
export const ToastContext = createContext<ToastApi | null>(null);

/** Never throws when unprovided: a missing toast must not break its caller. */
export function useToast(): ToastApi;
```

### `apps/web/src/utils/toast.constants.ts` (new)

```ts
export const TOAST_MAX_VISIBLE = 3;
/** Pending toasts beyond this are dropped oldest-first; visible ones never are. */
export const TOAST_QUEUE_CAP = 20;
/** `null` ⇒ persists until dismissed. */
export const TOAST_AUTO_HIDE_MS: Record<ToastSeverity, number | null> = {
  success: 4_000,
  info: 6_000,
  warning: 6_000,
  error: null,
};
export const TOAST_ANCHOR = { vertical: "bottom", horizontal: "right" } as const;
```

### `apps/web/src/providers/Toast.provider.tsx` (new)

`ToastProvider` owns the queue and renders `ToastHost`. Behavior contract:

| Rule | Exact behavior |
|---|---|
| Raise | `show()` appends `{ ...toast, id: crypto.randomUUID() }`. Ids are generated at raise time, never from a render-time counter — `StrictMode` double-invokes renders. |
| Visible set | The **first `TOAST_MAX_VISIBLE`** of the queue, oldest first (newest at the bottom, nearest the screen edge). |
| Auto-hide | Per visible toast, from `TOAST_AUTO_HIDE_MS[severity]`. `null` ⇒ no timer. A toast's timer starts when it becomes *visible*, not when queued. |
| Dedupe | A `show()` whose `(message, severity)` matches any **currently visible** toast is dropped. Pending duplicates are not compared. |
| Queue cap | At `TOAST_QUEUE_CAP`, drop the **oldest pending** toast (index ≥ `TOAST_MAX_VISIBLE`). Visible toasts are never evicted. |
| Dismiss | `dismiss(id)` removes that toast; the next pending one becomes visible and starts its timer. |
| Dismiss all | `dismissAll()` empties the queue — visible and pending. |
| Never | The system does not auto-dismiss an `error` to make room, under any pressure. |

### `apps/web/src/components/ToastHost.component.tsx` (new)

Pure UI — receives the visible toasts, the hidden count and callbacks; holds no state.

```ts
export interface ToastHostProps {
  toasts: Toast[];            // already sliced to TOAST_MAX_VISIBLE
  hiddenCount: number;        // queue.length - toasts.length
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}
```

**One** MUI `Snackbar` at `TOAST_ANCHOR` containing a `Stack` of `Alert`s — MUI Snackbars position absolutely and would overlap if several were mounted. Each `Alert` carries its severity, message, the optional action in its `action` slot, and a close button. When `hiddenCount > 0` a final row renders `+{hiddenCount} more` alongside a **Dismiss all** button; at `hiddenCount === 0` neither appears.

Test ids: `toast-host`, `toast-{severity}` per alert, `toast-overflow-count`, `toast-dismiss-all`.

### `apps/web/src/providers/Application.provider.tsx` (edit)

`ToastProvider` wraps `QueryClientProvider`'s children — inside `ThemeProvider` (MUI theming) and outside `RouterProvider`, which is mounted by `Application.tsx:12` *within* these providers, so toasts survive navigation:

```
StrictMode → Auth0Provider → ThemeProvider → LayoutProvider → QueryClientProvider → ToastProvider → children
```

### Migrations (edit)

| File | Change |
|---|---|
| `views/Toolpacks.view.tsx:355-358`, `:366`, `:417`, `:423`, `:481`, `:540-560` | Delete `RefreshToast`, the `useState`, and the Snackbar; call `toast.success(...)` / `toast.error(...)`. Anchor unchanged (already bottom-right). |
| `views/Settings.view.tsx:52`, `:344-355` | Delete the `billingToast` state and Snackbar; call the hook. **Anchor changes bottom-center → bottom-right**, and auto-hide 8s → 4s/6s by severity. The only migration with visible changes. |
| `views/EditLayoutPlan.view.tsx:239-250` | Delete the local `toast` element and its state; call the hook. Anchor unchanged (already bottom-right). |
| `components/UpdateBanner.component.tsx` | **No change** — add a comment recording why (polled condition, not an action outcome). Stays bottom-**center**, deliberately clear of the toast anchor. |
| `components/ConnectorInstanceSyncFeedback.component.tsx` | **No change** — add a comment recording why (phase progress, not an outcome). |

### `CLAUDE.md` (edit)

A short subsection beside "Form & Dialog Pattern (apps/web)": failures inside a dialog render `<FormAlert>`; failures with no form raise `useToast().error(...)`. No component holds its own `Snackbar` — `UpdateBanner` and `ConnectorInstanceSyncFeedback` are the two recorded exceptions and are not precedents.

## Migration / Seed

**None.** No DB schema, table, enum or seed data is touched — this is client-side UI infrastructure.

## TDD test plan

Run via `cd apps/web && npm run test:unit`.

### Layer 1 — the queue (`src/__tests__/Toast.provider.test.tsx`, new)

Driven through a probe component calling `useToast()`.

1. `show()` renders a toast with its message and severity.
2. Severity methods delegate — `toast.error(m)` yields severity `error`.
3. Up to 3 render simultaneously; a 4th does **not** render as an alert.
4. A 4th produces `hiddenCount === 1` → the overflow row shows `+1 more`.
5. `success` auto-dismisses after 4s (fake timers); `info`/`warning` after 6s.
6. **`error` never auto-dismisses** — advance well past every duration and it remains.
7. **An error and a success raised together are both visible**, and the success still fades while the error stays.
8. Each toast's timer starts when it becomes visible, not when queued — a 4th toast promoted after a dismissal gets a full duration.
9. `dismiss(id)` removes only that toast and promotes the next pending one.
10. `dismissAll()` clears visible and pending; the overflow row disappears.
11. Dedupe: an identical `(message, severity)` while the first is visible is dropped; a different message is not.
12. Queue cap: raising past `TOAST_QUEUE_CAP` drops the oldest **pending** toast, never a visible one.
13. Ids are unique across raises of identical content (id generation, not content, is the key).
14. `useToast()` with **no provider** returns no-ops — calling every method throws nothing and renders nothing.

### Layer 2 — the host (`src/__tests__/ToastHost.test.tsx`, new)

15. Renders one `Alert` per toast with the right severity test id.
16. An action renders its label and invokes `onClick`.
17. The close button calls `onDismiss` with that toast's id.
18. `hiddenCount > 0` renders `toast-overflow-count` with `+N more` **and** `toast-dismiss-all`; `onDismissAll` fires on click.
19. `hiddenCount === 0` renders **neither** the count nor Dismiss all.
20. Anchors bottom-right (asserted on the Snackbar's `anchorOrigin`) — and therefore never shares `UpdateBanner`'s bottom-center position.
20a. **An empty `toasts` array renders nothing at all** — no Snackbar, no container node. Added while planning: the provider joins the shared test harness, so an always-present node would perturb every existing suite and the 15 existing snapshots. This is the case that keeps the mounting slice inert.

### Layer 3 — the migrations (existing suites)

21. `Toolpacks` refresh success/failure paths still surface their message — asserted against the host's test ids now, since the old `toolpack-refresh-toast-*` id had no consumer.
22. `Settings` billing toast likewise.
23. `EditLayoutPlan` save-draft toast likewise.
24. None of the three renders its own `Snackbar` any more (source-level assertion, since the convention is the thing being fixed).

**Totals ≈ 25 cases.** No migration or seed test — nothing DB-touching.

## Acceptance criteria

- Any component raises a toast with one hook call and no local state.
- An error toast stays until dismissed; success/info/warning clear themselves.
- An error and a success raised together are both readable at once.
- A fourth concurrent toast appears as `+1 more`, not lost and not stacked.
- **Dismiss all** on that row clears every toast, visible and pending; the row goes with them.
- At ≤3 toasts there is no count row and no Dismiss all.
- A toast raised immediately before a navigation is still visible after the route changes.
- An error toast with a Retry action re-runs the operation when clicked.
- `Toolpacks`, `Settings` and `EditLayoutPlan` no longer own a `Snackbar`; `UpdateBanner` and `ConnectorInstanceSyncFeedback` do, each with a recorded reason.
- With no provider (Storybook, tests), raising a toast is a silent no-op.

## Risks & rollback

- **Fail-open by design.** No provider ⇒ no-ops; a toast failure never breaks the action that raised it. The cost is a silently missing notification, which is strictly better than a thrown error inside a success handler.
- **Unbounded queue growth** is the one leak: a retry loop behind a persistent error. Bounded by `TOAST_QUEUE_CAP` dropping oldest *pending*, plus dedupe absorbing the common repeat. Detected by test 12.
- **One anchor change is user-visible:** `Settings` moves bottom-center → bottom-right. `Toolpacks` and `EditLayoutPlan` are already bottom-right, so they are visual no-ops. `TOAST_ANCHOR` is one constant if this needs revisiting.
- **Timing changes for `Settings`** (8s → 4s/6s). Intentional consolidation; flagged because it is a behavior change to a shipped surface — and `Settings` is now the one migration where both placement and timing move.
- **A toast is never the sole record of a consequential failure.** Pin failures also render in the dialog (#285); data-mutation failures remain inspectable in their view. Notification history is out of scope, so nothing here should tempt a caller into treating a toast as an audit trail.
- **Rollback:** revert the branch. Nothing is persisted and no contract outside `apps/web` changes, so the three migrated views return to their local Snackbars with no data implications.

## Files touched

**New**
- `apps/web/src/utils/toast.context.tsx`
- `apps/web/src/utils/toast.constants.ts`
- `apps/web/src/providers/Toast.provider.tsx`
- `apps/web/src/components/ToastHost.component.tsx`
- `apps/web/src/__tests__/Toast.provider.test.tsx`
- `apps/web/src/__tests__/ToastHost.test.tsx`

**Edit**
- `apps/web/src/providers/Application.provider.tsx`
- `apps/web/src/views/Toolpacks.view.tsx`
- `apps/web/src/views/Settings.view.tsx`
- `apps/web/src/views/EditLayoutPlan.view.tsx`
- `apps/web/src/components/UpdateBanner.component.tsx` (comment only)
- `apps/web/src/components/ConnectorInstanceSyncFeedback.component.tsx` (comment only)
- existing `Toolpacks` / `Settings` / `EditLayoutPlan` test suites
- `CLAUDE.md`

## Next step

`docs/TOAST_PROVIDER.plan.md` carves this into **5 slices**, each a testable commit on this branch: (1) constants + context + `useToast` with the no-provider fallback (layer 1's cases 1–2, 14 — pure, no host yet); (2) the provider's queue with the full policy (cases 3–13, driven through a probe, host stubbed); (3) `ToastHost` as pure UI (layer 2); (4) mount in the provider chain, no consumers — inert; (5) the three migrations plus the two recorded holdouts and the `CLAUDE.md` entry (layer 3). Slice 4 is deliberately inert so a migration regression in slice 5 can't be confused with a mounting problem.
