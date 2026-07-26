# Visualization widget chrome + session render-load management — Spec

The contract for #271. Frames `d3` widgets with title + render/data status + the #270 refresh control, and bounds live sandboxed iframes by lazy-mounting the render body when near the viewport and tearing it down when far offscreen. Discovery: `docs/VIZ_WIDGET_CHROME.discovery.md`. Issue: [#271](https://github.com/EnterpriseBT/portal-ai/issues/271) (epic #267, branch `feat/viz-widget-chrome` → `epic/d3-dashboard-widgets`). Pure `apps/web` change.

## Key decisions (confirmed in discovery — flag for review)

1. **`useInView` (`IntersectionObserver`) mounts/tears down only viz widgets** (D1) — text/data-table/mutation blocks untouched.
2. **`ScrollRootContext` supplies the observer root** (D2) — `ChatWindowUI` provides its scroll container; the hook falls back to the viewport when unprovided (tests/Storybook).
3. **Container/body split** (D3) — the always-mounted container holds the cheap refresh/chrome state; the data paging + sandbox iframe move into an in-view-only child that disposes its bridge offscreen; a **height-preserving placeholder** holds layout.
4. **Gate the data fetch too, not just the iframe** (Open Q2) — an offscreen widget holds neither an iframe nor an open paging loop; it re-pages on scroll-back (cheap; #270 freshness gate).
5. **Streaming widgets** (D4) — render the frame + in-progress status, no refresh control (no `blockRef`); stay live because they're in view.
6. **Single `rootMargin` band, not two-margin hysteresis** — a spec-time simplification of the discovery lean: one generous band (mount when within it, tear down when beyond) bounds the live set with less machinery. Hysteresis is a later tuning knob if boundary thrash shows up. *(flag for review)*

## Scope

### In scope
- A `useInView` hook + a `ScrollRootContext` (+ `ChatWindowUI` provider).
- Framing `D3WidgetUI` (frame + status states) and splitting the render body into an in-view-gated child with a height-preserving placeholder.
- Storybook stories + unit tests for the frame states and the mount/teardown behavior.

### Out of scope
- Pinning affordance (#273) and dashboards (next epic); virtualizing non-`d3` blocks; any server/refresh behavior change (unchanged from #270).

## Surface

### `apps/web/src/utils/use-in-view.util.ts` (new)

```ts
export interface UseInViewOptions {
  /** Observer root; typically the chat scroll container via useScrollRoot().
   *  null → the browser viewport. */
  root?: Element | null;
  /** rootMargin band around the root within which the target counts as
   *  "in view" (mount) — beyond it, "out" (teardown). Default UI_INVIEW_MARGIN. */
  rootMargin?: string;
}
/** True while `ref`'s element is within `rootMargin` of the root. Starts false;
 *  flips on the first IntersectionObserver callback. Reconnects if root/margin
 *  change. When IntersectionObserver is unavailable (jsdom without a mock),
 *  returns `true` (fail-open — never hide content). */
export function useInView(
  ref: React.RefObject<Element | null>,
  opts?: UseInViewOptions
): boolean;
```
`UI_INVIEW_MARGIN` constant (e.g. `"100% 0px"` — one viewport above/below) lives beside the hook.

### `apps/web/src/utils/scroll-root.context.tsx` (new)

```ts
export const ScrollRootContext = React.createContext<Element | null>(null);
export function useScrollRoot(): Element | null; // = useContext(ScrollRootContext)
```

### `apps/web/src/components/ChatWindow.component.tsx` (edit)

`ChatWindowUI` exposes its scroll container to descendants: track the element in state via a callback ref (the `scrollRef` node), and wrap `children` in `<ScrollRootContext.Provider value={scrollEl}>`. No change to `ChatWindowHandle` or the existing `ResizeObserver` stick-to-bottom logic.

### `apps/web/src/modules/D3Widget/D3Widget.component.tsx` (edit — container + pure UI)

- **`D3Widget` (container):** keeps `useWidgetRefresh(blockRef, dataUpdatedAt)` (refresh state, `lastUpdatedAt`, auto-refresh) and adds `useInView(frameRef, { root: useScrollRoot() })`. Tracks `lastHeight` (from the body's `onRendered`, seeded `INITIAL_FRAME_HEIGHT`). Renders `D3WidgetUI` with the frame/chrome props + `inView` + `placeholderHeight={lastHeight}` + a `body` node it computes: `inView ? <D3WidgetBody … onRendered={setLastHeight} /> : null`.
- **`D3WidgetUI` (pure):** gains a **framed** container (MUI `Paper`, `variant="outlined"`, `data-testid="d3-widget"`), the existing header (title, "Updated ⟨time⟩ ago", refresh button), a **status** indicator, and a body region that renders `body` when `inView`, else a **placeholder** `<Box data-testid="d3-widget-placeholder" style={{height: placeholderHeight}} />`. New props:
  - `inView: boolean`
  - `placeholderHeight: number`
  - `status: "loading" | "rendering" | "ready" | "error" | "refreshing" | "stale"` — a small status chip; `stale` when data age > freshness and not refreshing (transitional; #270 auto-refresh clears it). Derived by the container.
  - `body?: React.ReactNode`
  - existing props retained (`program`/`batches`/… move into `D3WidgetBody`; `D3WidgetUI` no longer renders the sandbox directly).

### `apps/web/src/modules/D3Widget/D3WidgetBody.component.tsx` (new — in-view-only child)

Container that mounts **only when the parent is in view**. Runs `useProgressiveHandleRows(effectiveHandle)`, resolves inline vs handle batches, and renders the existing pure `<D3SandboxFrameUI>` (unchanged). Props: `{ program, params, theme, handle: string | null, inlineRows: Row[] | null, onRendered, onFrameError }`. On unmount (parent flips `inView → false`), `useProgressiveHandleRows` cleanup stops paging and `D3SandboxFrameUI`'s effect disposes the bridge — no leaked iframe/listeners.

### `apps/web/src/modules/D3Widget/utils/register.util.tsx` (edit)

Unchanged wiring, but the rendered tree is now `D3Widget` (container) which internally gates the body — the registry still passes `ctx.blockRef` / `ctx.dataUpdatedAt`.

## Migration
None — pure client-side React. No DB/schema/contract change.

## Seed
None.

## TDD test plan

### `apps/web` — `npm run test:unit`

- **`__tests__/use-in-view.util.test.ts`** (new): with a mock `IntersectionObserver` — returns `false` initially; flips `true` when the observer reports `isIntersecting`; flips `false` when it reports not-intersecting; passes the provided `root` + `rootMargin` to the observer; disconnects on unmount; returns `true` (fail-open) when `IntersectionObserver` is undefined. (~6)
- **`__tests__/scroll-root.context.test.tsx`** (new): `useScrollRoot` returns the provided element; `null` with no provider. (~2)
- **`ChatWindow.test.tsx`** (extend): a child rendered under `ChatWindowUI` reads a non-null scroll root via `useScrollRoot` once mounted; the stick-to-bottom behavior is unchanged. (~2)
- **`modules/D3Widget/__tests__/D3Widget.test.tsx`** (extend): with `inView=false` → renders `d3-widget-placeholder` at `placeholderHeight`, **no** iframe and **no** `handleSnapshotPage` call; with `inView=true` → renders the body (iframe + paging); the frame (`Paper`) + `status` chip render across loading/rendering/error/stale; a streaming widget (no `blockRef`) renders the frame + in-progress status with **no** refresh button; toggling `inView` true→false unmounts the body (no iframe) and back mounts + re-pages. Drive `D3WidgetUI` by props; drive the container with a controllable `useInView` (mock the hook or the observer). (~9)
- **`modules/D3Widget/__tests__/D3WidgetBody.test.tsx`** (new): mounts → pages the handle (or renders inline rows) and forwards `onRendered`/`onFrameError`; unmount stops paging. (~3)
- **Stories:** `stories/D3Widget.stories.tsx` (extend) — `Framed`, `Placeholder` (torn-down), `Stale`, `StreamingInProgress` states against `D3WidgetUI`. (pinned by story render, not counted)

**Totals ≈ 22 cases.** No migration/integration — client-only; `IntersectionObserver` is mocked in the unit tests (jsdom has none).

## Acceptance criteria

- In a session with many visualizations, only widgets within the `rootMargin` band hold a live iframe (bounded count); scrolling back to an older widget re-mounts and re-renders it from its block content.
- Scroll position/layout stay stable as widgets mount/unmount — a torn-down widget leaves a placeholder at its last rendered height (seeded `INITIAL_FRAME_HEIGHT`), never a zero-height gap.
- The widget frame shows title + data status; a stale/expired widget presents the inline refresh affordance; a refresh in flight is visibly pending and the control is not double-fireable (from #270).
- Text, data-table, and mutation-result blocks are visually and behaviorally unchanged (they never enter this path).
- Tearing a widget down disposes its sandbox bridge (no leaked iframe/listeners).

## Risks & rollback

- **Fail-safe rendering:** `useInView` fails **open** (returns `true`) when `IntersectionObserver` is missing, so content is never hidden; a torn-down widget always renders a sized placeholder (never a collapsed gap). Fail policy is presentation-only — no data/security dimension.
- **Bridge leaks** are the main risk: teardown must run `D3SandboxFrameUI`'s cleanup (`bridge.dispose()`); the unmount-on-`inView=false` path is exactly what triggers it — asserted in tests.
- **Scroll-root timing:** the provider value is null until `ChatWindowUI` mounts; `useInView` reconnects when the root becomes available, and meanwhile falls back to the viewport — no missed mounts.
- **Rollback:** the frame + gating are additive within the D3 module + two new util files; reverting restores today's always-mounted, unframed `D3Widget`. No data migration.

## Files touched

- **New:** `apps/web/src/utils/use-in-view.util.ts`, `apps/web/src/utils/scroll-root.context.tsx`, `apps/web/src/modules/D3Widget/D3WidgetBody.component.tsx`; their tests (`__tests__/use-in-view.util.test.ts`, `__tests__/scroll-root.context.test.tsx`, `modules/D3Widget/__tests__/D3WidgetBody.test.tsx`).
- **Edit:** `apps/web/src/components/ChatWindow.component.tsx` (+ `ChatWindow.test.tsx`), `apps/web/src/modules/D3Widget/D3Widget.component.tsx` (+ `D3Widget.test.tsx`), `modules/D3Widget/utils/register.util.tsx`, `modules/D3Widget/stories/D3Widget.stories.tsx`.

## Next step

`/plan 271` on this branch. The plan will carve ~3 TDD slices: (1) `useInView` + `ScrollRootContext` + `ChatWindow` provider (leaf infra, no widget change yet); (2) `D3WidgetUI` frame + status states + stories (chrome, still always-mounted body); (3) the body split — `D3WidgetBody` + in-view gating + height-preserving placeholder + teardown. Each green-testable, each a commit on `feat/viz-widget-chrome`, PRing into `epic/d3-dashboard-widgets`.
