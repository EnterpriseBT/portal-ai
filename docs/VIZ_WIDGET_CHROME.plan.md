# Visualization widget chrome + session render-load management — Plan

**Three TDD slices: the viewport infra (`useInView` + `ScrollRootContext`), then the widget frame (visual only), then the in-view-gated body split that bounds live iframes — leaf infra first, the lifecycle change last.**

Spec: `docs/VIZ_WIDGET_CHROME.spec.md`. Discovery: `docs/VIZ_WIDGET_CHROME.discovery.md`. Issue: #271 (epic #267). Builds on #269 (mints `d3` blocks) + #270 (`D3Widget` refresh chrome + `blockRef`/`dataUpdatedAt` threading), both merged into `epic/d3-dashboard-widgets`.

3 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/viz-widget-chrome`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR"), PRing into `epic/d3-dashboard-widgets`.

Run tests from the package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — **S1** is standalone infra (an `IntersectionObserver` hook + a scroll-root context + the `ChatWindow` provider), inert until a widget consumes it, so it lands first and green. **S2** frames `D3WidgetUI` (Paper + status chip) around the **still-always-mounted** body — a pure visual change, no lifecycle behavior yet, so it can't regress rendering. **S3** does the load-management: extract the body into `D3WidgetBody`, gate it with S1's `useInView`, and swap a height-preserving placeholder when offscreen. No slice depends on a later one.

---

## Slice 1 — Viewport infra: `useInView` + `ScrollRootContext` + `ChatWindow` provider

The reusable near-viewport hook, the context that supplies its root, and the `ChatWindow` provider — no widget consumes them yet.

**Files**

- New: `apps/web/src/utils/use-in-view.util.ts` — `useInView(ref, { root?, rootMargin? })` + `UI_INVIEW_MARGIN`; fail-open (`true`) when `IntersectionObserver` is absent.
- New: `apps/web/src/utils/scroll-root.context.tsx` — `ScrollRootContext` + `useScrollRoot()`.
- Edit: `apps/web/src/components/ChatWindow.component.tsx` — track the scroll element in state (callback ref on the existing scroll Box) and wrap `children` in `<ScrollRootContext.Provider>`; no change to `ChatWindowHandle` or the `ResizeObserver` stick-to-bottom.
- New tests: `__tests__/use-in-view.util.test.ts`, `__tests__/scroll-root.context.test.tsx`; edit `__tests__/ChatWindow.test.tsx`.

**Steps**

1. **Tests (spec cases: use-in-view ~6, scroll-root ~2, ChatWindow ~2).** Mock `IntersectionObserver`: hook returns `false` initially, `true` on `isIntersecting`, `false` on leave, passes `root`+`rootMargin` to the observer, disconnects on unmount, fail-opens `true` when the global is undefined. `useScrollRoot` returns the provided element / `null` unprovided. A child under `ChatWindowUI` reads a non-null scroll root once mounted; stick-to-bottom unchanged. Run; fail.
2. **Implement** the hook, the context, and the provider. Green.
3. Lint + type-check.

**Done when:** the hook + context cases pass; `ChatWindowUI` provides its scroll container; nothing in `D3Widget` uses any of it yet.

**Risk:** jsdom has no `IntersectionObserver` — the tests must install a mock (there is no shared polyfill); the hook's fail-open path is what keeps untested render paths safe.

---

## Slice 2 — Frame `D3WidgetUI` (visual only, body still always-mounted)

Wrap the widget in an outlined `Paper` frame with a status chip, keeping the #270 header (title, "Updated ⟨time⟩ ago", refresh). The sandbox body still renders inline and always mounts — no lifecycle change.

**Files**

- Edit: `apps/web/src/modules/D3Widget/D3Widget.component.tsx` — `D3WidgetUI` gains the `Paper variant="outlined"` frame (keep `data-testid="d3-widget"`) and a `status` prop (`"loading"|"rendering"|"ready"|"error"|"refreshing"|"stale"`) rendered as a chip; the container derives `status` from its existing state. Body rendering unchanged (still `<D3SandboxFrameUI>` inline).
- Edit: `modules/D3Widget/stories/D3Widget.stories.tsx` — add `Framed` / `Stale` / `StreamingInProgress` stories.
- Edit: `modules/D3Widget/__tests__/D3Widget.test.tsx` — frame + status-chip cases.

**Steps**

1. **Tests (spec cases: D3Widget frame/status subset).** The frame (`Paper`) renders; the `status` chip shows loading / rendering / error / stale / refreshing per props; a streaming widget (no `blockRef`) shows the frame + in-progress status and **no** refresh button; existing #270 header/refresh/updated-caption cases still pass. Run; fail.
2. **Implement** the frame + status chip + derivation. Green.
3. Lint + type-check.

**Done when:** the frame + status cases pass; the widget looks framed with a status chip; body is still always-mounted (no regression to #268/#270 rendering).

**Risk:** don't disturb the existing `d3-widget-loading` / `d3-widget-error` / header test ids — the frame wraps them, it doesn't replace them.

---

## Slice 3 — In-view-gated body split + height-preserving placeholder

Extract the render body into `D3WidgetBody` and mount it only when near the viewport (S1's `useInView`); a torn-down widget shows a placeholder at its last rendered height and disposes its sandbox bridge.

**Files**

- New: `apps/web/src/modules/D3Widget/D3WidgetBody.component.tsx` — container: `useProgressiveHandleRows(handle)` + inline-rows resolution → `<D3SandboxFrameUI>`; props `{ program, params, theme, handle, inlineRows, onRendered, onFrameError }`.
- Edit: `D3Widget.component.tsx` — container adds `useInView(frameRef, { root: useScrollRoot() })` + tracks `lastHeight` (from body `onRendered`, seed `INITIAL_FRAME_HEIGHT`); moves `useProgressiveHandleRows` out into `D3WidgetBody`. `D3WidgetUI` gains `inView` + `placeholderHeight` + `body` props; renders `body` when `inView`, else `<Box data-testid="d3-widget-placeholder" style={{height}}>`.
- New test: `modules/D3Widget/__tests__/D3WidgetBody.test.tsx`; edit `D3Widget.test.tsx` (gating/placeholder/teardown); edit `stories/D3Widget.stories.tsx` (`Placeholder`).

**Steps**

1. **Tests (spec cases: D3Widget gating/placeholder/teardown ~5, D3WidgetBody ~3).** `inView=false` → `d3-widget-placeholder` at `placeholderHeight`, **no** iframe, **no** `handleSnapshotPage` call; `inView=true` → body (iframe + paging); toggling true→false unmounts the body (no iframe) and back re-mounts + re-pages; placeholder height seeds `INITIAL_FRAME_HEIGHT` then uses last rendered height. `D3WidgetBody`: mounts → pages/inline-renders + forwards `onRendered`/`onFrameError`; unmount stops paging. Drive the container with a controllable `useInView` (mock the hook or the observer). Run; fail.
2. **Implement** the `D3WidgetBody` extraction, the `useInView` gating, the placeholder, and `lastHeight` capture. Green.
3. Lint + type-check (full `apps/web` unit at the boundary — this is the behavioral change).

**Done when:** all gating/placeholder/teardown + `D3WidgetBody` cases pass; offscreen widgets hold neither an iframe nor an open paging loop and leave a sized placeholder; scroll-back re-mounts and re-renders from block content.

**Risk:** the sandbox bridge must be disposed on teardown — the `inView=false` unmount is what triggers `D3SandboxFrameUI`'s cleanup; assert no iframe after teardown. Keep `D3WidgetUI` pure (it renders the `body` node the container hands it; the container owns `useInView`).

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `useInView` + `ScrollRootContext` + `ChatWindow` provider | web unit green; infra unused by widgets |
| 2 | `D3WidgetUI` frame + status chip + stories (body always-mounted) | web unit green; framed, no lifecycle change |
| 3 | `D3WidgetBody` + in-view gating + placeholder + teardown | web unit green; live iframes bounded, scroll stable |

## Cross-slice notes

- **`D3WidgetUI` stays pure across all slices** — S2 adds the frame/status, S3 makes it render a `body` node + placeholder; the container (`D3Widget`) owns `useInView`, `useWidgetRefresh`, and the mount decision. No hooks migrate *into* the pure component.
- **No forward deps:** S3 consumes S1's `useInView`/`useScrollRoot`; S2 is independent of both.
- **The streaming path is unchanged** — a streaming `d3` block renders through the same registered renderer with no `blockRef`; it's in view (bottom, auto-scrolled) so it stays mounted, and its non-refreshable state is #270's behavior.
- **Doc-sync:** none needed — the "Visualization Widget" glossary term + refresh FAQ (added in #270) already cover the user-facing concept; the frame/lazy-mount is internal UX, introduces no new term, and touches no tool/help/README surface.
- **`IntersectionObserver` mocking** is required in the unit tests (jsdom lacks it); the fail-open path keeps any unmocked render safe.

## Next step

Implementation begins on `feat/viz-widget-chrome`, slice 1 first (tests → green → lint/type-check), one commit per slice — only after discovery + spec + plan are reviewed and confirmed.
