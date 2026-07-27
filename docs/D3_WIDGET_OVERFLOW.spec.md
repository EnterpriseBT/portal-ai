# D3 widget overflow & sizing — Spec

Pins the widget sizing contract — **available width in, painted extent out, vertical fit invariant** — and the additive protocol fields, measurement rule, frame sizing, and codegen guidance that implement it.

**Issue:** [EnterpriseBT/portal-ai#278](https://github.com/EnterpriseBT/portal-ai/issues/278) · **Discovery:** [`docs/D3_WIDGET_OVERFLOW.discovery.md`](./D3_WIDGET_OVERFLOW.discovery.md)

## Key decisions (flag for review)

1. **The host supplies available width; the frame reports painted extent; height is always the painted extent** (discovery D0). Resizing is responsive-only in every host — no manual handles. A second host (future custom dashboard) supplies a different width and nothing else.
2. **"Fits its visualization vertically, never scrolls vertically" is an invariant, not a host policy** — expressed once in a shared sizing rule (`resolveFrameSize`), not duplicated per host and not buried in the bootstrap.
3. **Additive fields under `v: 1`** — `rendered`/`resize` gain an optional `width`; no version bump (`docs/D3_SANDBOX_RUNTIME.spec.md:16` reserves the version field for exactly this).
4. **Painted extent is measured per top-level child of `#root`, `getBBox()` for SVG and `getBoundingClientRect()` otherwise** — O(top-level children), not a walk over every mark, so a 10k-mark chart doesn't pay a per-batch measurement tax (discovery enterprise-scale → scale).
5. **`api.width` is always the host's available width, never the grown frame width**, and `api.height` is always the same constant suggestion — this is what makes the growth loop reach a fixed point after one cycle instead of ratcheting (discovery OQ 2, 3).
6. **`api.width` constrains, `api.height` does not** (discovery D4) — the prompt's current "size to `api.width` / `api.height` so re-renders stay bounded" is replaced.
7. **Fail-open everywhere**: a measurement that throws or yields a non-finite value falls back to `scrollWidth`/`scrollHeight` and then to the existing `|| INITIAL_FRAME_HEIGHT` guard; a missing `ResizeObserver` keeps the mount-time width. A sizing bug must never blank a chart that would otherwise render.

## Scope

### In scope

- Optional `width` on the `rendered` and `resize` frame→parent messages (both ends).
- In-frame painted-extent measurement replacing bare `root.scrollHeight`.
- Sandbox CSS: SVG content may paint outside its viewport; the frame never shows its own scrollbars.
- Parent-side frame sizing: height = painted height (unbounded); width = `max(paintedWidth, containerWidth)`, making the existing `overflowX: "auto"` wrapper a working horizontal scroller.
- Parent-side `ResizeObserver` → rAF-coalesced `bridge.sendResize`, so available width tracks the container for the life of the mount.
- Codegen guidance: asymmetric axis semantics + worked-example margins.
- Updating `docs/D3_SANDBOX_RUNTIME.spec.md`'s protocol section (it documents shipped behavior).

### Out of scope

- Any interaction message (zoom/pan/brush) — the sandbox spec deferred cross-boundary interaction and this adds none.
- An "open larger" / full-screen affordance.
- The dashboard host itself (tile layout, reordering, persistence); this only makes the contract able to serve it.
- A height ceiling (discovery OQ 5), row-count truncation (#277), in-flight tool activity (#279).
- Broader chart-design guidance in the codegen prompt beyond sizing.

## Surface

### `apps/web/src/modules/D3Widget/utils/bridge.util.ts`

`BRIDGE_PROTOCOL_VERSION` stays `1`. Two schemas gain an optional field; nothing is removed or made required:

```ts
const RenderedMessageSchema = versioned.extend({
  type: z.literal("rendered"),
  height: z.number(),
  rowCount: z.number(),
  /** Painted content width in px (#278). Optional: absent ⇒ use container width. */
  width: z.number().optional(),
});

const ResizeMessageSchema = versioned.extend({
  type: z.literal("resize"),
  height: z.number(),
  width: z.number().optional(),
});

export interface SandboxBridgeCallbacks {
  onRendered(event: { height: number; rowCount: number; width?: number }): void;
  onResize(event: { height: number; width?: number }): void;
  onError(event: { message: string; stack?: string }): void;
}
```

`createSandboxBridge`'s `rendered` / `resize` cases forward `width` when present (omitted key when absent, matching the existing `stack` handling at `:177`). `SandboxBridge.sendResize(size: { width: number; height: number })` is unchanged — it is the existing, currently-unreachable path.

### `apps/web/src/modules/D3Widget/utils/widget-sizing.util.ts` (new)

The shared, host-agnostic sizing rule — the single expression of Key decision 2:

```ts
export interface FrameSizeInput {
  /** Painted content width in px, if the frame reported one. */
  contentWidth?: number;
  /** Painted content height in px, if the frame reported one. */
  contentHeight?: number;
  /** The width the host has available (chat column, dashboard tile, …). */
  containerWidth: number;
  /** Height used before the frame has reported anything. */
  fallbackHeight: number;
}

export interface FrameSize {
  /** `max(contentWidth, containerWidth)` — never less than the container. */
  width: number;
  /** The painted height, unbounded. Never clamped, never a scroll viewport. */
  height: number;
}

/**
 * Available width in, painted extent out, vertical fit invariant (#278).
 * Non-finite or non-positive inputs fall back rather than propagating NaN —
 * a sizing bug must not blank a chart.
 */
export function resolveFrameSize(input: FrameSizeInput): FrameSize;
```

Rules: `width = max(usable(contentWidth) ?? 0, usable(containerWidth) ?? 0)`, and if that is `0`, `containerWidth`'s fallback is the frame's existing `FALLBACK_FRAME_WIDTH`; `height = usable(contentHeight) ?? fallbackHeight`. `usable(n)` = `Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined`.

### `apps/web/src/modules/D3Widget/utils/raf-coalesce.util.ts` (new)

```ts
/**
 * Wrap `fn` so calls within one animation frame collapse to a single
 * invocation with the LAST argument (#278). Responsive reflow is bursty —
 * a window-edge drag or panel open produces a run of observer ticks.
 * Falls back to synchronous invocation when rAF is unavailable.
 */
export function rafCoalesce<T>(fn: (value: T) => void): {
  (value: T): void;
  cancel(): void;
};
```

### `apps/web/src/modules/D3Widget/utils/sandbox-bootstrap.js` (in-frame)

Adds one function and changes two report sites. Still standalone, ES5, no imports.

```js
/** Painted extent of #root's content, in CSS px, relative to #root's origin.
 *  Per top-level child: getBBox() for SVG (catches marks drawn outside the
 *  declared viewport, which the layout box does not), getBoundingClientRect()
 *  otherwise. O(top-level children) — never a walk over every mark. */
function measureContent() // → { width: number, height: number }
```

Per element child of `#root`:

- **SVG** (`typeof el.getBBox === "function"`): `bbox = el.getBBox()`; scale from `el.getScreenCTM()` (`a`, `d`; default `1` when null); candidate extent = `(bbox.x + bbox.width) * a`, `(bbox.y + bbox.height) * d`; also take the element's own layout rect, so an SVG sized larger than its content still counts.
- **Non-SVG**: `rect = el.getBoundingClientRect()` minus `#root`'s own rect origin → `right`, `bottom`.

Then `width = max(all extents.x, root.scrollWidth)`, `height = max(all extents.y, root.scrollHeight)`, each `Math.ceil`'d. The whole body is wrapped in `try/catch`; on throw, or if a result is non-finite or `<= 0`, it returns `{ width: root.scrollWidth, height: root.scrollHeight }` — today's behavior.

**Negative extents are measured too, and shifted into view** (amended during the smoke walk — see below). `measureContent` also tracks `minX`/`minY` (only negatives matter) and returns `offsetX`/`offsetY` = the overshoot before `#root`'s origin; `width`/`height` include the shift.

`applyExtent(size)` then **grows `#root` to the measurement and pads it by the offsets**: `minWidth`/`minHeight` from `width`/`height`, `paddingLeft`/`paddingTop` from `offsetX`/`offsetY`. Both are required, and neither is optional:

- **Growing `#root`** is what makes escaped marks visible at all. Measuring alone is not enough: marks that escape the SVG viewport also escape the *body* box — whose height is only the SVG's declared layout height — and the srcdoc's `overflow:hidden` clips them there. The frame grows to the right size and the content stays invisible.
- **Padding `#root`** brings negative-coordinate content into view. Growing cannot reach it (it lies before the origin); shifting the content right/down by the overshoot can. The standard d3 rotated-tick-label idiom (`rotate(-45)` + `text-anchor: end`) hangs labels down-**left** and lands exactly there, so this is the common case, not an edge case.

`releaseExtent()` clears all four properties before each re-measure, so `scrollWidth`/`scrollHeight` can't read back the applied values (which would let a widget only ever grow, never shrink). Resize posts are guarded on a real change, since applying the extent resizes `#root` and re-fires the in-frame `ResizeObserver`.

Report sites:

- `renderPass` (`:69`): `post("rendered", { height: size.height, width: size.width, rowCount: rows.length })`.
- `ResizeObserver` on `#root` (`:118-124`): `post("resize", { height: size.height, width: size.width })`.

Unchanged: the `resize` **in**-message handler (`:111-115`) still overwrites the stored `width`/`height` and schedules a render — it is the parent that now actually sends it.

### `apps/web/src/modules/D3Widget/utils/sandbox-srcdoc.util.ts`

The `<style>` at `:39` becomes:

```
html,body{margin:0;padding:0;overflow:hidden}#root{width:100%}#root svg{overflow:visible}
```

- `#root svg{overflow:visible}` — marks outside a declared viewport actually paint once the frame grows to fit them. Without it, measurement would grow the frame around content that stays invisible.
- `html,body{overflow:hidden}` — the frame never shows its own scrollbars in either axis, including during the one frame between "content overflows" and "parent has grown". Horizontal scrolling belongs to the host's wrapper (discovery OQ 1); vertical scrolling exists nowhere.

`SANDBOX_CSP` is unchanged (`style-src 'unsafe-inline'` already covers this).

### `apps/web/src/modules/D3Widget/D3SandboxFrame.component.tsx`

Props (`D3SandboxFrameUIProps`) are unchanged except that `onRendered` widens to the bridge's new payload:

```ts
onRendered?: (event: { height: number; rowCount: number; width?: number }) => void;
```

Behavior:

- State becomes a single `frameSize: FrameSize` (from `resolveFrameSize`) instead of the lone `frameHeight` at `:43`.
- A `containerWidthRef` tracks `iframe.parentElement?.clientWidth || FALLBACK_FRAME_WIDTH`. **The wrapper is measured, never the iframe** — the iframe sits inside the wrapper and cannot influence its `clientWidth`, which is what closes the feedback loop (discovery OQ 2).
- `onRendered` / `onResize` recompute `frameSize` via `resolveFrameSize({ contentWidth: event.width, contentHeight: event.height, containerWidth: containerWidthRef.current, fallbackHeight: INITIAL_FRAME_HEIGHT })`.
- **New effect:** a `ResizeObserver` on `iframe.parentElement`, its callback wrapped in `rafCoalesce`, updating `containerWidthRef` and calling `bridge.sendResize({ width: <container width>, height: INITIAL_FRAME_HEIGHT })`. It also recomputes `frameSize` so the frame narrows back when the column does. Disposed with the bridge; **no-op when `ResizeObserver` is undefined** (fail-open, matching `sandbox-bootstrap.js:118` and `useInView`'s precedent from #271).
- **The suggested height sent on resize is always `INITIAL_FRAME_HEIGHT`, never the current painted height** — feeding painted height back would ratchet (program sizes to it, paints slightly past it, grows again). Key decision 5.
- `init.size` still carries `{ width: containerWidth, height: INITIAL_FRAME_HEIGHT }`.
- iframe style: `width: frameSize.width` (px) with `minWidth: "100%"`, `height: frameSize.height`, `border: 0`, `display: "block"`. **No `maxHeight`, no `overflowY`.**

### `apps/web/src/modules/D3Widget/D3Widget.component.tsx`

`CHART_BOUNDS` (`:31-34`) gains an explicit vertical rule so the invariant is visible at the host, not implied:

```ts
const CHART_BOUNDS: React.CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  overflowX: "auto",
  overflowY: "visible", // #278: never a vertical scroller; the frame fits its content
};
```

`onHeight` continues to be fed from `onRendered`'s `height` (`:204`), so #271's `D3WidgetGate` placeholder (`D3WidgetGate.component.tsx:56`, `:68`) keeps preserving scroll position off the now-authoritative painted height. No change to the gate.

### `apps/api/src/prompts/visualize-d3.prompt.ts`

Three edits to `VISUALIZE_D3_CODEGEN_SYSTEM`:

1. The `api.width` / `api.height` lines (`:27-28`) become explicit about asymmetry — `api.width` is the available width to lay out for, which the chart may exceed only when intrinsically wider (the host scrolls horizontally); `api.height` is a suggested starting height the program may exceed freely, because the widget always grows to fit what is painted.
2. The `:42` bullet "Size to api.width / api.height so re-renders stay bounded" is **replaced** — it currently steers directly toward the clipping being fixed. The replacement states: lay out to `api.width`; never compress, clip, or scroll content to fit a height; give axis labels, tick labels, and legends the room they need and let the widget grow.
3. The worked example (`:48-62`) keeps its shape but stops modelling label-clipping geometry: the hardcoded `height = 260` becomes height derived from the suggested `api.height`, and the `margin` left/bottom values are sized for realistic tick labels rather than `40`/`28`.

`buildCodegenPrompt` is unchanged.

### `docs/D3_SANDBOX_RUNTIME.spec.md`

Protocol section updated to match shipped behavior: step 4 (`:142`) and step 6 (`:144`) report `{ height, width }`; the `SandboxOutMessageSchema` / `SandboxBridgeCallbacks` sketch (`:155-160`) carries the optional `width`; a line records that the sizing contract is available-width-in / painted-extent-out with vertical fit invariant, and that `v: 1` is retained because the fields are additive.

## Migration / Seed

**None.** No DB schema, table, enum, or seed data is touched — this is client-side layout plus one prompt string.

## TDD test plan

Run via `npm run test:unit` (web + api). Never invoke jest/npx directly — the ESM setup needs the script's `NODE_OPTIONS`.

### Layer 1 — bridge protocol (`apps/web/src/modules/D3Widget/utils/__tests__/bridge.util.test.ts`)

1. `rendered { height, rowCount, width }` parses and `onRendered` receives `width`.
2. `rendered` **without** `width` still parses; `onRendered` receives no `width` key (additive-optional back-compat).
3. `resize { height, width }` parses and `onResize` receives `width`.
4. `sendResize({ width, height })` posts `{ type: "resize", size, v: 1, nonce }` (queued before `ready`, flushed after).

### Layer 2 — sizing + coalescing utils (`…/utils/__tests__/widget-sizing.util.test.ts`, `…/utils/__tests__/raf-coalesce.util.test.ts`, new)

5. `resolveFrameSize`: content narrower than container → width = container.
6. Content wider than container → width = content (this is what makes the wrapper scroll).
7. Height is always the painted height — no clamping against container or fallback when a painted height exists.
8. Missing `contentHeight` → `fallbackHeight`; missing `contentWidth` → container width.
9. Non-finite / zero / negative inputs fall back instead of yielding `NaN` or `0`.
10. `rafCoalesce`: three calls in one frame → one invocation, with the last value.
11. `rafCoalesce`: invokes synchronously when `requestAnimationFrame` is unavailable; `cancel()` prevents a pending invocation.

### Layer 3 — frame behavior (`apps/web/src/modules/D3Widget/__tests__/D3SandboxFrame.test.tsx`)

12. A `rendered` carrying `width` greater than the container sets the iframe's style width to that width (with `minWidth: 100%`).
13. A `rendered` carrying a smaller `width` leaves the iframe at container width.
14. Reported `height` sets the iframe height with no `maxHeight` and no `overflowY` on the element.
15. A container resize drives `bridge.sendResize` with the **container** width and `INITIAL_FRAME_HEIGHT` as the suggested height — never the painted height (the anti-ratchet assertion).
16. **Fixed point:** container width W, frame reports content width 2W → iframe grows; the observer firing again reports container width W unchanged, so `sendResize` is not called with a grown width and the size stabilizes (discovery OQ 2, 6).
17. Multiple observer ticks in one frame produce a single `sendResize` (coalescing, via the util's seam).
18. `ResizeObserver` undefined → mount succeeds, initial render unaffected, no throw (fail-open).

### Layer 4 — host wiring (`…/__tests__/D3Widget.test.tsx`, `…/__tests__/D3WidgetGate.test.tsx`)

19. `CHART_BOUNDS` renders with `overflow-x: auto` and a non-scrolling `overflow-y`, and no `max-height`.
20. `onHeight` still fires with the reported painted height (the gate's placeholder contract).
21. Gate placeholder height continues to track the last painted height across an out-of-view → in-view cycle (regression on #271).

### Layer 5 — sandbox document (`…/utils/__tests__/sandbox-srcdoc.util.test.ts`, `…/utils/__tests__/sandbox-bootstrap.test.ts`)

22. The srcdoc's style block contains `#root svg{overflow:visible}` and `html,body{…overflow:hidden}`; `SANDBOX_CSP` is unchanged and the doc still contains no `http://` / `https://`.
23. Bootstrap source contains the load-bearing markers `getBBox`, `getScreenCTM`, `scrollWidth`, and still `new Function("api"`, `requestAnimationFrame`, `ResizeObserver`.

**Coverage gap, stated deliberately:** the bootstrap is asserted at the **source-string level only**, because it is loaded via `?raw` and jsdom implements neither layout nor `getBBox`/`getScreenCTM` — so an executed test would exercise only the fallback branch and prove nothing about measurement. This matches #268's resolved Q5 (bootstrap execution covered by Storybook + manual smoke). The real verification of measurement is the smoke walk against the Sankey and beeswarm from the issue's repro.

### Layer 6 — codegen prompt (`apps/api/src/__tests__/prompts/visualize-d3.prompt.test.ts`)

24. The system prompt states the asymmetric axis semantics (available width to lay out for; height a suggestion that may be exceeded).
25. It no longer contains the "stay bounded" instruction.
26. The worked example derives height from `api.height` rather than hardcoding `260`.

**Totals ≈ 26 cases** (web ≈ 23, api ≈ 3).

## Acceptance criteria

- The issue's two repro charts render complete: the Sankey's node labels are all reachable, and the beeswarm shows both swarms with no cut-off sliver.
- A chart wider than the chat column shows a **horizontal** scrollbar on the widget and every part is reachable by scrolling.
- **No vertical scrollbar appears on a widget, ever** — neither on the wrapper nor inside the frame — and no chart is cut off vertically at any height.
- Narrowing the browser window (or the chat column) re-lays-out the chart at the new width without a remount, and widening it back restores the original layout.
- A widget mounted in a column narrower than 640px lays out for the real width, not the 640px fallback.
- A chart that initially clips settles at a correct size within one growth cycle and then stays stable (no oscillation, no unbounded ratchet).
- Existing widgets still render, refresh (#270), and lazily mount/tear down with a stable scroll position (#271).
- With `ResizeObserver` unavailable, widgets still render at mount width — degraded, not broken.

## Risks & rollback

- **Visual churn** (discovery OQ 4): `overflow: visible` means previously-hidden marks now paint, so some existing charts will look different. Accepted — a drawn mark was meant to be seen — with a smoke step comparing several chart forms before/after.
- **Negative-offset content — resolved during the smoke walk, not deferred.** This spec originally recorded it as a known limitation and a follow-up ticket. The walk showed it is the *common* case rather than an edge one (rotated tick labels hang down-left, so the leftmost label always lands at negative x), and clipped tick labels are the headline symptom #278 reports — so deferring would have shipped the reported bug half-fixed. `#root` is now padded by the overshoot. The residual risk is cosmetic: a chart with negative-offset content shifts right/down rather than staying put, which is the correct trade against being unreachable.
- **Two clipping layers, not one.** The smoke walk found that measuring correctly is insufficient — the body box clips what escapes the SVG. Anything that changes the srcdoc CSS or `#root`'s box model must keep both layers in mind: the SVG may overflow, and the document box must contain the result.
- **Feedback loop / ratchet** — the failure mode of this design. Guarded three ways: the observer measures the wrapper (never the iframe), the suggested height sent on resize is constant, and test 16 pins the fixed point.
- **Measurement cost per render pass.** Bounded to top-level children by Key decision 4; progressive batches already coalesce through `requestAnimationFrame`. If a pathological chart regresses, the fallback path (`scrollWidth`/`scrollHeight`) is a one-line revert of `measureContent`'s body.
- **Fail-open by design**, and the safe direction here: a sizing failure degrades to today's cropping rather than to a blank widget. There is no cost or safety dimension — nothing is metered, billed, or persisted.
- **Rollback:** revert the branch. The protocol fields are optional and both ends ship in the same bundle, so no persisted data or stored block content depends on them; previously-minted `d3` blocks render identically after a revert.

## Files touched

**New**
- `apps/web/src/modules/D3Widget/utils/widget-sizing.util.ts`
- `apps/web/src/modules/D3Widget/utils/raf-coalesce.util.ts`
- `apps/web/src/modules/D3Widget/utils/__tests__/widget-sizing.util.test.ts`
- `apps/web/src/modules/D3Widget/utils/__tests__/raf-coalesce.util.test.ts`

**Edit**
- `apps/web/src/modules/D3Widget/utils/bridge.util.ts`
- `apps/web/src/modules/D3Widget/utils/sandbox-bootstrap.js`
- `apps/web/src/modules/D3Widget/utils/sandbox-srcdoc.util.ts`
- `apps/web/src/modules/D3Widget/D3SandboxFrame.component.tsx`
- `apps/web/src/modules/D3Widget/D3Widget.component.tsx`
- `apps/web/src/modules/D3Widget/utils/__tests__/bridge.util.test.ts`
- `apps/web/src/modules/D3Widget/utils/__tests__/sandbox-bootstrap.test.ts`
- `apps/web/src/modules/D3Widget/utils/__tests__/sandbox-srcdoc.util.test.ts`
- `apps/web/src/modules/D3Widget/__tests__/D3SandboxFrame.test.tsx`
- `apps/web/src/modules/D3Widget/__tests__/D3Widget.test.tsx`
- `apps/web/src/modules/D3Widget/__tests__/D3WidgetGate.test.tsx`
- `apps/api/src/prompts/visualize-d3.prompt.ts`
- `apps/api/src/__tests__/prompts/visualize-d3.prompt.test.ts`
- `docs/D3_SANDBOX_RUNTIME.spec.md`

## Next step

`docs/D3_WIDGET_OVERFLOW.plan.md` carves this into **4 slices**, each a testable commit on this branch: (1) protocol width field + in-frame measurement + sandbox CSS (layers 1 and 5 — inert until slice 2 consumes it); (2) `widget-sizing.util.ts` + frame sizing from reported extent, which is where the cropping visibly stops (layers 2 and 3, tests 12–14); (3) `raf-coalesce.util.ts` + the parent-side `ResizeObserver` → `sendResize` wiring with the fixed-point and coalescing assertions (tests 15–18); (4) codegen prompt semantics + worked example, plus the `docs/D3_SANDBOX_RUNTIME.spec.md` protocol update (layer 6). Slice 4 is independent of 1–3 and could land first if convenient.
