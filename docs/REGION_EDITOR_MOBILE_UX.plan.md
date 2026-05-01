# Region Editor — Mobile UX Implementation Plan (Option C: long-press to engage)

Implementation plan for `docs/REGION_EDITOR_MOBILE_UX.discovery.md`. Adopts **Option C** — long-press on touch to engage canvas gestures; native single-finger pan otherwise. Mouse and pen behavior on the desktop is identical to today; only `pointerType === "touch"` events take the new code path.

GitHub issue: #28.

## 1. Goals

1. On a touch device, a single-finger drag inside the spreadsheet view scrolls the grid using the browser's native pan, with no React state change and no false region drafts.
2. A user can still draw, select, move, resize, segment-resize, and edit-intersection on touch — by holding the finger still on the target for ~350 ms before moving. Haptic feedback (`navigator.vibrate`) signals commitment.
3. Mouse pointerdown (any button) and pen pointerdown (`pointerType === "pen"`) act exactly as today — no timer, no movement threshold. Every existing test that fires a synthetic mouse-style pointer event continues to pass without modification.
4. `pointercancel` (e.g. browser preempting the gesture, OS interrupt) is treated as a clean abort: any in-flight long-press timer is cleared and no draft is committed.
5. The same long-press model applies uniformly to every pointerdown entry point in the canvas tree: grid body, column header, row header, corner header, region body (move), resize handles, segment dividers, intersection edit blocks. One gesture to learn.

## 2. Non-goals

- No mode toggle (Options A and B from the discovery doc).
- No two-finger gestures. Pinch-zoom is not added.
- No change to the auto-scroll-at-edges behavior during an active draw — once a long-press has primed an `activeOp`, the existing edge-scroll loop continues to apply (and now also benefits touch users, since their drag is captured).
- No reflow of the surrounding configuration panel / entity legend / step header for narrow viewports — that is a separate layout problem.
- No change to `RegionDrawingStep`'s `useMediaQuery` plumbing — touch detection is per-event (`pointerType`), not per-viewport.
- No haptic implementation behind a feature flag — `navigator.vibrate?.(15)` is best-effort and silent on unsupported browsers.

## 3. TDD plan — write these tests first, watch them fail, then implement

Run via package scripts (per `feedback_use_npm_test_scripts`): `npm run test:unit -- --testPathPattern=RegionEditor` from `apps/web/`. Type-check via `npm run type-check`.

### 3.1 Mouse path is unchanged
File: `apps/web/src/modules/RegionEditor/__tests__/SheetCanvas.test.tsx`

Existing tests already fire `fireEvent.pointerDown(...)` without a `pointerType`; jsdom defaults to `""` (treated as `"mouse"`). Re-run the full suite — every test must continue to pass byte-for-byte. No edits to existing assertions. If a test starts failing, the implementation has regressed desktop behavior and must be reworked.

Add an explicit guard test:

1. **Mouse pointerdown immediately starts a draw.** `fireEvent.pointerDown(cell, { pointerId: 1, pointerType: "mouse", clientX, clientY })` — verify `pendingBounds` is rendered after a single move event without any timer advance.
2. **Pen pointerdown immediately starts a draw.** Same as (1) but `pointerType: "pen"`.

### 3.2 Touch tap (no long-press) — selection only
File: `apps/web/src/modules/RegionEditor/__tests__/SheetCanvas.test.tsx`

Use `jest.useFakeTimers()` and `jest.advanceTimersByTime(...)` to control the long-press clock.

1. **Touch tap on empty cell does not draft a region.** Pointer down + immediate up on a body cell, no timer advance. `onRegionDraft` not called; `onRegionSelect` called with `null` (matches today's "click outside" semantics).
2. **Touch tap inside an existing region selects it.** Pointer down + up at a coord inside `region.bounds`, no timer advance. `onRegionSelect` called with the region id; `onRegionDraft` not called.
3. **Touch tap that moves > 10 px before release is a pan, not a selection.** Pointer down at (100, 100), pointer move to (130, 100), pointer up. Neither `onRegionDraft` nor `onRegionSelect` fires. (The browser would have handled the pan natively; the React handlers stay quiet.)

### 3.3 Touch long-press — engages draw
File: same.

1. **Touch hold ≥ 350 ms then drag draws a region.** Pointer down on `cell-1-1`, advance timers 350 ms, pointer move to `cell-3-3`, pointer up. `onRegionDraft` called with the normalized bounds.
2. **Touch hold < 350 ms then drag does NOT draw.** Pointer down, advance 200 ms, pointer move to a far cell, pointer up. `onRegionDraft` not called.
3. **Move during prime cancels the timer.** Pointer down, pointer move 30 px (still pre-350 ms), advance 500 ms, pointer up. `onRegionDraft` not called even though wall-clock fired the timer — the timer was cancelled before firing.
4. **`pointercancel` during prime cancels the timer.** Pointer down, fire `pointercancel`, advance 500 ms, pointer up. No draft, no selection, no errors.

### 3.4 Touch long-press on each entry point
File: same.

For each existing handler-bearing element, mirror the pattern in 3.3.1:

1. **Column header long-press draws a column band.** Pointer down on `[data-col-header]`, advance 350 ms, move horizontally, up. `onRegionDraft` with `startCol === endCol === colHeader value`.
2. **Row header long-press draws a row band.** Symmetric.
3. **Corner header long-press selects whole sheet.** Pointer down on `[data-corner-header]`, advance 350 ms, up. `onRegionDraft` called with full-sheet bounds.
4. **Region-body long-press starts a move op.** A region without segments. Pointer down on the region body, advance 350 ms, move, up. `onRegionResize` called with the moved bounds. (Selection happens on the synchronous tap path — see 3.5.)
5. **Resize handle long-press starts a resize.** Pointer down on `[aria-label="Resize region se"]`, advance 350 ms, move, up. `onRegionResize` called with resized bounds.
6. **Segment divider long-press starts a segment resize.** Pointer down on `segment-divider-row-0`, advance 350 ms, move, up. `onSegmentResize` fires.
7. **Intersection edit block long-press opens the popover.** Pointer down on a `pivot-pivot` overlay, advance 350 ms, up. `IntersectionEditPopoverUI` mounts open.

### 3.5 Touch tap on region body still selects synchronously
File: same.

A region body tap should feel snappy (no 350 ms wait for selection). Selection runs on pointerdown; the move op is what's gated behind the long-press.

1. **Touch pointerdown on region body calls `onRegionSelect` immediately.** Pointer down on region body. `onRegionSelect` called with region id synchronously (no timer advance). `onRegionResize` not called. Pointer up without timer advance — no move op committed.

### 3.6 Storybook
File: `apps/web/src/modules/RegionEditor/stories/SheetCanvas.stories.tsx` (create if missing — `RegionDrawingStep` story exists; if no canvas-only story is present, add the touch behavior to the existing `RegionDrawingStep` story).

Add a "Touch — long-press to draw" story variant. Wraps the canvas in a small overlay caption explaining the gesture so QA on a real device knows what to do. No interaction harness — the story is for manual device testing.

### 3.7 Type-check / lint
- `npm run type-check` clean across the web workspace.
- `npm run lint` clean — no new warnings.

## 4. Implementation steps

Each step lands in dependency order. Run the relevant 3.x tests after each step.

### Step 1 — Add long-press primitives to `SheetCanvas.component.tsx`

File: `apps/web/src/modules/RegionEditor/SheetCanvas.component.tsx`

Constants near the top of the module (alongside `EDGE_SCROLL_ZONE`):

```ts
const LONG_PRESS_MS = 350;
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
```

A new ref + helper inside the component:

```ts
type PrimedPress = {
  pointerId: number;
  startX: number;
  startY: number;
  // Fired when the timer expires with no movement-cancel.
  commit: (clientX: number, clientY: number) => void;
  // Fired on pointerup-before-timer (a "tap").
  tap?: (clientX: number, clientY: number) => void;
  timerId: ReturnType<typeof setTimeout>;
};
const primedRef = useRef<PrimedPress | null>(null);

const cancelPrimedPress = useCallback(() => {
  if (primedRef.current) {
    clearTimeout(primedRef.current.timerId);
    primedRef.current = null;
  }
}, []);

const primeLongPress = useCallback(
  (
    e: React.PointerEvent,
    args: {
      commit: (clientX: number, clientY: number) => void;
      tap?: (clientX: number, clientY: number) => void;
    }
  ) => {
    cancelPrimedPress();
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const timerId = setTimeout(() => {
      if (primedRef.current?.timerId !== timerId) return;
      const last = lastPointerRef.current ?? { x: startX, y: startY };
      navigator.vibrate?.(15);
      args.commit(last.x, last.y);
      primedRef.current = null;
    }, LONG_PRESS_MS);
    primedRef.current = {
      pointerId,
      startX,
      startY,
      commit: args.commit,
      tap: args.tap,
      timerId,
    };
  },
  [cancelPrimedPress]
);
```

Add cleanup to the existing unmount effect (the one that cancels `autoScrollFrameRef`):

```ts
return () => {
  cancelPrimedPress();
  if (autoScrollFrameRef.current != null) cancelAnimationFrame(autoScrollFrameRef.current);
};
```

### Step 2 — Refactor each pointerdown handler into a "commit" body + a touch-aware wrapper

Each existing handler becomes two pieces: the (unchanged) action-taking body, and a thin wrapper that branches on `pointerType`. The body is callable both synchronously (mouse/pen) and from inside a `setTimeout` (touch).

#### 2a. `handleGridPointerDown`

Extract the existing body into `commitGridPress(target, clientX, clientY)`. The wrapper:

```ts
const handleGridPointerDown = useCallback(
  (e: React.PointerEvent) => {
    if (readOnly) return;
    const target = e.target as HTMLElement | null;
    if (e.pointerType === "touch") {
      primeLongPress(e, {
        commit: (cx, cy) => commitGridPress(target, cx, cy, e.pointerId),
        tap: (cx, cy) => {
          // Touch tap fallback: select the region at this point or clear.
          const coord = clientToCell(cx, cy);
          if (!coord) return;
          const hit = regions.find(
            (r) => r.sheetId === sheet.id && coordInBounds(coord, r.bounds)
          );
          onRegionSelect(hit?.id ?? null);
        },
      });
      return;
    }
    commitGridPress(target, e.clientX, e.clientY, e.pointerId, e);
  },
  [readOnly, primeLongPress, clientToCell, regions, sheet.id, onRegionSelect]
);
```

`commitGridPress` does what the current handler does (corner / col-header / row-header / body draw start), but reads coords from arguments and calls `scrollRef.current?.setPointerCapture(pointerId)` instead of `capturePointer(e)`. The optional `e` argument is used only for `e.preventDefault()` on the synchronous mouse path.

#### 2b. `handleRegionBodyPointerDown`

Special-cased: selection is *synchronous* on both mouse and touch (immediate feedback for tap-to-select); the **move op** is what's gated. The handler becomes:

```ts
return (e: React.PointerEvent) => {
  e.stopPropagation();
  e.preventDefault();
  onRegionSelect(regionId);
  if (readOnly || !onRegionResize) return;
  const target = regions.find((r) => r.id === regionId);
  const hasSegments = ...; // unchanged
  if (hasSegments) return;
  const start: () => void = () => {
    scrollRef.current?.setPointerCapture(e.pointerId);
    const coord = clientToCell(... ) ?? ...;
    setActiveOp({ kind: "move", regionId, originalBounds, pointerStart: coord, current: coord });
  };
  if (e.pointerType === "touch") {
    primeLongPress(e, { commit: start });
    return;
  }
  start();
};
```

#### 2c. `handleResizeStart`, `handleSegmentDividerPointerDown`

Same shape: extract a `start()` closure and either call it directly (mouse/pen) or pass it to `primeLongPress` (touch). No `tap` fallback for these — the user explicitly targeted a small affordance, so a tap should do nothing rather than (e.g.) trigger spurious selection.

#### 2d. Intersection edit block (in the inline `intersectionEls` map)

Today's `onPointerDown` calls `setEditingIntersection(...)` synchronously. Wrap it the same way:

```ts
onPointerDown: (event) => {
  event.stopPropagation();
  event.preventDefault();
  const open = () => {
    onRegionSelect(previewRegion.id);
    setEditingIntersection({ ...stable, anchor: event.currentTarget });
  };
  if (event.pointerType === "touch") {
    primeLongPress(event, { commit: open });
    return;
  }
  open();
};
```

Note: capture `event.currentTarget` *before* any async branch — the event is pooled and `currentTarget` is null after the handler returns. The `open` closure must close over the captured DOM node, not read it from `event` later.

### Step 3 — Make `handlePointerMove` / `handlePointerUp` / `handlePointerCancel` long-press aware

Top of `handlePointerMove`, before the existing `applyPointerCoord` path:

```ts
if (primedRef.current && primedRef.current.pointerId === e.pointerId) {
  const dx = e.clientX - primedRef.current.startX;
  const dy = e.clientY - primedRef.current.startY;
  if (dx * dx + dy * dy > LONG_PRESS_MOVE_TOLERANCE_PX ** 2) {
    cancelPrimedPress();
  }
  return; // primed phase swallows pointer-move
}
```

Top of `handlePointerUp`:

```ts
if (primedRef.current && primedRef.current.pointerId === e.pointerId) {
  const tap = primedRef.current.tap;
  cancelPrimedPress();
  tap?.(e.clientX, e.clientY);
  return; // do not run the activeOp commit path
}
```

`onPointerCancel` already routes to `handlePointerUp`. Cancel just clears the timer (no tap fallback) — handled by the same guard via the `tap` being absent or by adding a sibling `handlePointerCancel` that calls `cancelPrimedPress()` and falls through to `stopAutoScroll()`.

### Step 4 — Switch the scroll container's `touchAction`

`SheetCanvas.component.tsx:978`:

```ts
touchAction: "pan-x pan-y",
```

This lets the browser handle single-finger pans natively whenever React isn't holding the pointer. Once a long-press primes a draw and we call `setPointerCapture(pointerId)`, the captured pointer is owned by JS and the browser stops trying to pan it.

Leave the segment-divider's local `touchAction: "none"` (`SheetCanvas.component.tsx:1479`) untouched. The divider is a small affordance reached by a long-press; with the long-press model it can engage immediately on touch via the wrapper above, but local `touchAction: "none"` keeps any movement after capture from accidentally being interpreted as pan.

### Step 5 — Inflate touch hit-areas (resize handles, segment dividers)

Targets that are 8 px on the wire are unhittable by a finger (~44 px). Add a transparent padded hit-area without enlarging the visible chrome:

- **Resize handles** (`RegionOverlay.component.tsx:235-256`): wrap each `Box` in an outer 24×24 transparent box that owns the `onPointerDown` and centers the visible 8×8 dot. Cursor stays on the inner element.
- **Segment dividers** (`SheetCanvas.component.tsx:1454-1488`): bump `handleSize` from 8 to 24 on touch (or always — 24 is comfortable for mouse too). Keep the visible tint band confined to the 8 px center via an inner element.

This change is independent of long-press but must land in the same patch — without it, the long-press is unreachable on these targets.

### Step 6 — Storybook variant

Add a "Touch — long-press to draw" story to either the existing `RegionDrawingStep` story or a new `SheetCanvas.stories.tsx`. Description string in the story args explains the gesture; no special test-mode harness needed.

### Step 7 — Manual device verification

Before merge: load the Storybook story or a dev-server route on a real iOS device (Safari) and an Android device (Chrome). Verify:
- Single-finger drag pans without drafting a region.
- Long-press (~350 ms) on a body cell starts a draw; the dashed `pendingBounds` rectangle appears under the finger; dragging extends it; release commits.
- Long-press on a column header draws the column band.
- Long-press on a region body starts a move; release commits.
- Long-press on a resize handle resizes; same for segment divider.
- Tapping inside an existing region selects it without delay.
- Tap outside any region clears selection.

Type checking and Jest cover the gesture state machine, but the actual native panning interaction can only be confirmed on-device.

## 5. Files touched

- `apps/web/src/modules/RegionEditor/SheetCanvas.component.tsx` — long-press refs/helpers, refactored pointerdown handlers, modified pointermove/up/cancel guards, `touchAction` flip, divider hit-area.
- `apps/web/src/modules/RegionEditor/RegionOverlay.component.tsx` — resize-handle hit-area inflation.
- `apps/web/src/modules/RegionEditor/__tests__/SheetCanvas.test.tsx` — new sections "Mouse path unchanged", "Touch tap", "Touch long-press", "Touch long-press per entry point", "Touch tap selects region body".
- `apps/web/src/modules/RegionEditor/stories/` — touch-mode story (new file or addendum).

No backend changes. No API changes. No schema changes. No new dependencies.

## 6. Acceptance criteria

1. The full Jest suite passes (`npm run test:unit`) including all new tests in §3.
2. Every existing `SheetCanvas.test.tsx` test passes without modification (proof of no desktop regression).
3. `npm run type-check` and `npm run lint` clean.
4. On-device verification (§4 step 7) checks all six listed behaviors on both iOS Safari and Android Chrome.
5. No new console warnings during a normal drawing session in dev mode.

## 7. Risks and mitigations

- **`setPointerCapture` after a 350 ms delay may be rejected by some browsers if the pointer has already been internally promoted to a scroll gesture.** Mitigation: the movement-cancel guard (§3.3 case 3) ensures we only call capture after the user has held still for 350 ms — by definition no scroll has started. If a browser still rejects the capture, the draw will simply not engage, which is no worse than the current state (where it can't engage at all). Catch any thrown `NotFoundError` in a try/catch to keep the handler resilient (mirrors the existing `capturePointer` pattern at `SheetCanvas.component.tsx:259-265`).
- **Stale `event.currentTarget` in the intersection-edit branch.** Pooled React events null `currentTarget` after the handler returns. Mitigation: capture the DOM node into a local variable inside the handler, before scheduling the long-press (Step 2d explicitly addresses this).
- **iOS Safari long-press conflicts with native context-menu / text-selection.** The grid cells are non-selectable text inside a `userSelect: "none"` parent (line 977), and the canvas is not a hyperlink, so the iOS long-press → context-menu pathway should not fire. If a specific iOS version still triggers it, add `WebkitTouchCallout: "none"` to the scroll container's `sx`.
- **Apple Pencil treated as touch.** Apple Pencil reports `pointerType === "pen"` on iPadOS, which our wrapper routes to the synchronous mouse-style path — fast, no long-press wait. This is the desired behavior.
- **Tests using `setTimeout` clocks.** Using `jest.useFakeTimers()` inside the touch tests must not leak into the mouse-path tests. Each test in the touch section either resets timers in `beforeEach`/`afterEach` or wraps `useFakeTimers()` locally.
- **Discoverability.** Long-press is invisible until learned. Mitigation belongs to a follow-up: a one-time toast or empty-state hint reading "Hold to draw a region" on first touch entry to the drawing step. Out of scope for this plan — flagged as a follow-up issue if QA reports new-user confusion.

## 8. Out of scope, queued as follow-ups

- **First-time tutorial / hint banner** for the long-press gesture.
- **Pinch-to-zoom** for high-resolution sheets — would let users see more cells at once.
- **Layout reflow** of the configuration panel for narrow viewports.
- **Long-press duration as a user preference** — accessibility users may want a longer or shorter window.
