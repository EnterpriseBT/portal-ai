# Shared toast provider — Plan

**Implements the toast contract leaf-first: constants and hook, then the pure host, then the queue that composes them, then the mount, then the three migrations.**

Spec: `docs/TOAST_PROVIDER.spec.md`. Discovery: `docs/TOAST_PROVIDER.discovery.md`. Issue: #293. Unblocks **#286**, whose unpin-failure surface is the first consumer (its design doc is parked on `chore/unpin-sdk-bypass`).

5 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/toast-provider`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from the package (never invoke jest directly):

```bash
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale.** Slice 1 is pure leaf — constants and the context whose only behavior is its no-provider fallback, so it can be tested with nothing else built. Slice 2 is `ToastHost`, also a leaf: it is pure UI over the types from slice 1 and has no dependency on the queue, which means slice 3 can render the **real** host rather than a stub. Slice 3 adds the queue policy, the only slice with genuine logic. Slice 4 mounts the provider in the app chain *and* the shared test harness — deliberately inert, so a migration regression in slice 5 cannot be confused with a mounting problem. Slice 5 does the three migrations, the two recorded holdouts and the `CLAUDE.md` entry.

**Host-before-provider is the load-bearing ordering choice.** The reverse would force slice 2 to stub a host it then throws away.

---

## Slice 1 — Constants, context, and the fail-open hook

The types every later slice depends on, plus the one behavior testable in isolation: `useToast()` outside a provider is a silent no-op.

**Files**

- New: `apps/web/src/utils/toast.constants.ts` — `TOAST_MAX_VISIBLE`, `TOAST_QUEUE_CAP`, `TOAST_AUTO_HIDE_MS`, `TOAST_ANCHOR`.
- New: `apps/web/src/utils/toast.context.tsx` — `ToastSeverity`, `ToastAction`, `ToastOptions`, `Toast`, `ToastApi`, `ToastContext`, `useToast()`.
- New: `apps/web/src/__tests__/toast.context.test.tsx`.

**Steps**

1. **Tests (spec case 14, plus the constants' contract).** `useToast()` rendered with **no provider** returns an object whose every method (`success`, `info`, `warning`, `error`, `show`, `dismiss`, `dismissAll`) can be called without throwing and renders nothing. `TOAST_AUTO_HIDE_MS.error` is `null` while the other three are finite numbers — the asymmetry is a contract, not an implementation detail. `TOAST_ANCHOR` is bottom-**right**. Run; fail.
2. **Implement** the constants and the context module. `useToast()` returns a stable module-level no-op object when the context is `null`, mirroring `scroll-root.context.tsx`'s documented-fallback shape. Green.
3. Lint + type-check.

**Done when:** case 14 passes and the constants assert their contract. Nothing renders a toast yet; nothing imports these but the test.

**Risk:** none — pure module.

---

## Slice 2 — `ToastHost` as pure UI

One `Snackbar` containing a `Stack` of `Alert`s, plus the overflow row. No state, no queue.

**Files**

- New: `apps/web/src/components/ToastHost.component.tsx`.
- New: `apps/web/src/__tests__/ToastHost.test.tsx`.

**Steps**

1. **Tests (spec cases 15–20, plus one addition).** One `Alert` per toast with `toast-{severity}` test ids; an action renders its label and fires `onClick`; the close button calls `onDismiss` with the right id; `hiddenCount > 0` renders `toast-overflow-count` (`+N more`) **and** `toast-dismiss-all`, whose click calls `onDismissAll`; `hiddenCount === 0` renders neither; `anchorOrigin` is bottom-right.
   **Addition not in the spec:** an **empty `toasts` array renders nothing at all** — no Snackbar, no container node. Slice 4 mounts this into the shared test harness, so an always-present DOM node would perturb every existing suite and the 15 existing snapshots. Add this case to the spec's test plan.
   Run; fail.
2. **Implement** the host: return `null` when there are no toasts; otherwise one `Snackbar` at `TOAST_ANCHOR` wrapping a `Stack` of `Alert`s, newest nearest the screen edge, with the conditional overflow row. Green.
3. Lint + type-check.

**Done when:** cases 15–20 plus the empty-render case pass. The host is unreferenced outside its test.

**Risk:** the empty-render rule is what keeps slice 4 inert. If it is missed, slice 4 breaks unrelated suites and the cause will look like the mount rather than the host.

---

## Slice 3 — The provider's queue

The only slice with real logic: raise, visible-set slicing, per-severity timers, dedupe, cap, dismiss, dismiss-all.

**Files**

- New: `apps/web/src/providers/Toast.provider.tsx` — owns the queue, renders the real `ToastHost` from slice 2.
- New: `apps/web/src/__tests__/Toast.provider.test.tsx` — driven through a probe component calling `useToast()`.

**Steps**

1. **Tests (spec cases 1–13).** `show()` renders with message + severity; severity methods delegate; 3 visible max and a 4th does not render as an alert; a 4th yields `+1 more`; `success` auto-dismisses at 4s and `info`/`warning` at 6s (fake timers); **`error` never auto-dismisses** past every duration; **an error and a success raised together are both visible, and the success still fades while the error stays**; a promoted toast gets a full duration from when it becomes *visible*; `dismiss(id)` removes one and promotes the next; `dismissAll()` clears visible and pending and the overflow row goes with them; dedupe drops a `(message, severity)` match against a **visible** toast but not a different message; the cap drops the oldest **pending** and never a visible one; ids are unique across identical raises. Run; fail.
2. **Implement** the provider per the spec's behavior table — `crypto.randomUUID()` ids at raise time (not a render counter, because `StrictMode` double-invokes renders), one timer per visible toast keyed by id. Green.
3. Lint + type-check.

**Done when:** cases 1–13 pass. The provider is mounted nowhere.

**Risk:** timer bookkeeping is where this slice can go wrong — a timer must be cleared when its toast is dismissed early, and started when a pending toast is *promoted*, not when it was queued. Case 8 (promoted toast gets a full duration) is the one that catches a naive implementation.

---

## Slice 4 — Mount it, inert

The provider joins the app chain and the shared test harness. No consumers yet, and nothing visible changes.

**Files**

- Edit: `apps/web/src/providers/Application.provider.tsx` — `ToastProvider` inside `QueryClientProvider`, i.e. inside `ThemeProvider` and outside the `RouterProvider` that `Application.tsx:12` mounts within it.
- Edit: `apps/web/src/__tests__/test-utils.tsx` — add `ToastProvider` to `renderWithProviders`' wrapper, mirroring the app chain.

**Steps**

1. **Tests.** A probe rendered with the house `render()` from `test-utils` receives a **real** API rather than the no-op — raising a toast renders it. This is what slice 5's migration assertions depend on: without the provider in the harness, a migrated view's `toast.error(...)` silently no-ops and cases 21–23 would pass while asserting nothing. Also assert the whole existing suite is unaffected: full `npm run test:unit`, including the 15 snapshots, must be green with the provider mounted in every test. Run; fail (probe gets no-ops).
2. **Implement** both mounts. Green.
3. Lint + type-check.

**Done when:** the probe test passes and the **entire** web suite is green with no snapshot churn. No production surface raises a toast yet.

**Risk:** **this is the slice most likely to disturb unrelated tests.** Mitigated by slice 2's empty-render rule; if any snapshot moves, the host is rendering a node it should not. Do not "update" a snapshot to accommodate it — that would hide the fault.

---

## Slice 5 — Migrations, holdouts, and the convention

Three views drop their local Snackbars; two keep theirs with a recorded reason; `CLAUDE.md` gains the rule.

**Files**

- Edit: `apps/web/src/views/Toolpacks.view.tsx` — delete `RefreshToast` (`:355-358`), its `useState` (`:366`) and the Snackbar (`:540-560`); the three raise sites (`:417`, `:423`, `:481`) call the hook. Anchor unchanged (already bottom-right).
- Edit: `apps/web/src/views/Settings.view.tsx` — delete `billingToast` (`:52`) and the Snackbar (`:344-355`). **The only migration with visible changes:** anchor bottom-center → bottom-right, auto-hide 8s → 4s/6s.
- Edit: `apps/web/src/views/EditLayoutPlan.view.tsx` — delete the local `toast` element and state (`:239-250`). Anchor unchanged.
- Edit: `apps/web/src/components/UpdateBanner.component.tsx` — comment only: polled condition, not an action outcome; stays bottom-center, deliberately clear of the toast anchor.
- Edit: `apps/web/src/components/ConnectorInstanceSyncFeedback.component.tsx` — comment only: phase progress, not an outcome.
- Edit: `CLAUDE.md` — a subsection beside "Form & Dialog Pattern (apps/web)": in-dialog failures render `<FormAlert>`; failures with no form raise `useToast().error(...)`; no component holds its own `Snackbar`, and the two exceptions above are recorded exceptions rather than precedents.
- Edit: the `Toolpacks` / `Settings` / `EditLayoutPlan` test suites.

**Steps**

1. **Tests (spec cases 21–24).** Each view's success and failure paths still surface their message — asserted against the host's `toast-{severity}` ids, since `Toolpacks`' old `toolpack-refresh-toast-*` id had **no consumer** and there is nothing to preserve. Plus a source-level assertion that none of the three imports `Snackbar` any more, because the convention is the thing being fixed and a behavioral test cannot catch a reintroduction. Run; fail.
2. **Implement** the three migrations, the two comments and the `CLAUDE.md` entry. Green.
3. Lint + type-check.

**Done when:** cases 21–24 pass, no migrated view imports `Snackbar`, and `CLAUDE.md` states the rule. #286 can now consume `useToast` on its own branch.

**Risk:** `Settings` carries both a placement and a timing change, so it is the one to watch in the smoke walk. The two holdout comments are the only guard against a future reader treating them as precedent — if they are vague, the seventh Snackbar arrives eventually.

---

## Sequence summary

| Slice | What lands | Gating check |
|---|---|---|
| 1 | Constants + context + fail-open `useToast` | Case 14 + constants contract — pure, unreferenced |
| 2 | `ToastHost` pure UI, **renders nothing when empty** | Cases 15–20 + empty-render — unreferenced |
| 3 | The queue: timers, dedupe, cap, dismiss-all | Cases 1–13 — mounted nowhere |
| 4 | Mount in app chain + test harness | Probe gets a real API; **full suite + snapshots unchanged** |
| 5 | 3 migrations, 2 holdout comments, `CLAUDE.md` | Cases 21–24; no `Snackbar` import in the three |

**Totals ≈ 25 cases** — the spec's 24 plus slice 2's empty-render addition.

## Cross-slice notes

- **The spec needs one addition:** `ToastHost` renders nothing for an empty list (slice 2). It is not in the spec's test plan and it is what makes slice 4 inert.
- **`Toast` and `ToastApi` span slices 1–3.** Slice 1 defines them; 2 consumes the type; 3 implements the API. No signature changes at the boundaries.
- **Fake timers are required from slice 3 onward.** Cases 5–8 are timing assertions; use jest's fake timers and advance explicitly. Never assert on elapsed wall-clock — this repo already carries four wall-clock-sensitive flakes, and a timing-based toast test would become the fifth.
- **Doc-sync is slice 5's `CLAUDE.md` entry**, per `CLAUDE.md` → "Keeping Documentation in Sync with Capabilities". This change introduces a convention, so the convention file is part of the same PR — not a follow-up.
- **#286 is the downstream consumer.** It does not land here; slice 5 completing is what unblocks it.
- **No migration, no seed** — nothing DB-touching in this ticket.

## Next step

Implementation begins on `feat/toast-provider`, slice 1 first, tests-first, one commit per slice — once discovery, spec and plan are reviewed and confirmed. `/smoke 293` scaffolds the walkthrough after slice 5, where `Settings` (the one migration changing both placement and timing) and the overflow row's Dismiss all are the two things most worth walking.
