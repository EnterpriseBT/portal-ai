# Region Editor — Mobile UX Discovery

## Problem

On touch devices the region editor is effectively unusable. Any attempt to scroll the spreadsheet grid by dragging a finger immediately starts drawing a new region instead of panning the viewport. There is no way to inspect a sheet that is wider or taller than the screen without first creating (and then having to delete) an unwanted region. The same single-finger gesture currently means both "scroll" and "draw" — the editor resolves the ambiguity in favor of "draw" 100% of the time.

This blocks every downstream interaction in the region-drawing step (region selection, region resize, segment-divider drag, intersection editing) on phones and small tablets.

GitHub issue: #28.

## Where the bug lives

A single React module, `apps/web/src/modules/RegionEditor/SheetCanvas.component.tsx`, owns every gesture inside the spreadsheet view. The decisions that produce the bug:

1. **`touchAction: "none"` on the scroll container** (`SheetCanvas.component.tsx:978`). This disables native touch scrolling for the entire grid. Every touch is forwarded to the React `onPointerDown`/`onPointerMove`/`onPointerUp` handlers; the browser never gets a chance to interpret one as a pan.
2. **`handleGridPointerDown` always claims the gesture** (`SheetCanvas.component.tsx:396-444`). On any pointer-down inside the grid body it calls `setActiveOp({ kind: "draw", ... })` and `setPointerCapture`. The handler does not inspect `event.pointerType`, `event.isPrimary`, or any notion of "how many fingers are down."
3. **Region-body and resize-handle pointer-downs** in `RegionOverlay.component.tsx:156, 241` likewise capture immediately, so even if the user starts a touch on top of an existing region (intending to scroll the grid past it) they begin a move/resize op.
4. **Segment dividers also set `touchAction: "none"`** (`SheetCanvas.component.tsx:1479`) — same reason, same consequence on touch.

The reason `touchAction: "none"` is set globally is that the editor relies on uninterrupted Pointer Events for the entire draw/move/resize lifecycle. On a `touchAction: auto` surface the browser claims the gesture as soon as it looks like a pan and fires `pointercancel` on the captured pointer, which would abort an in-progress draw mid-stroke. The current code chose "always draw, never scroll" rather than handle that ambiguity.

The auto-scroll-at-edges behavior (`updateAutoScroll`, `SheetCanvas.component.tsx:334-385`) does work on touch — but only *after* a draw has already started, which is exactly the moment the user wants to avoid on mobile.

## Goal

A mobile user can pan the spreadsheet freely with one finger, *and* still has a discoverable, low-friction way to draw a new region, select an existing region, drag a region's bounds, and drag a segment divider. Desktop behavior (mouse drag = draw, hover = cursor change) must not regress.

## Non-goals

- Reflowing the surrounding chrome (configuration panel, entity legend, stepper) for narrow viewports. That is a separate layout problem; this doc is scoped to gesture handling on the canvas.
- A full pinch-to-zoom implementation. Cell sizes stay fixed.
- Reworking how regions are committed/interpreted. Only the gesture surface changes.

## Approaches

### Option A — Two-finger drag draws, single-finger pans natively

Switch the scroll container to `touchAction: "pan-x pan-y"`. On touch:
- A single touch pointer is *not* claimed by the canvas. The browser pans the grid as it would any scroll surface.
- A second touch pointer landing on the canvas while the first is still down upgrades the gesture into a "draw" op, using the midpoint (or the second finger) as the anchor.
- Resize handles, segment dividers, and intersection edit blocks would each need their own touch-vs-pan decision (they could keep `touchAction: "none"` because they are small, deliberate targets).

On mouse, behavior is unchanged: single-button drag still draws.

**Pros**: matches the user's suggested model; native panning is fast, momentum-aware, and free; column-header / row-header drawing (which selects whole columns/rows) can continue to use single-finger drag because those strips are not pannable in their own axis.

**Cons**: two-finger precision on a small grid is rough — the "start cell" of a two-finger draw is not obvious (which finger anchors?); discoverability is poor (no visual hint that the gesture exists); accessibility concern for users who cannot place two fingers reliably (one-handed phone use, motor impairments).

### Option B — Explicit Pan / Draw mode toggle

A small floating toggle on the canvas (hand icon ↔ marquee icon), visible on touch devices only (or always, for parity). The toggle flips a `mode` state:
- **Pan mode**: `touchAction: "pan-x pan-y"`; the body's `onPointerDown` is a no-op for touch; existing-region selection is still possible via tap.
- **Draw mode**: `touchAction: "none"`; current behavior — drag draws.

**Pros**: maximally discoverable (the affordance is on screen); accessible (one finger always works); the user is never surprised by what their drag will do; trivial to implement.

**Cons**: one extra tap per mode switch; easy for a user to forget which mode they're in and tap-tap-tap with no effect; toggling adds chrome to a view that already has a configuration panel competing for canvas room on small screens.

### Option C — Long-press to arm a draw

Default the canvas to `touchAction: "pan-x pan-y"`. A long-press (≈ 350ms) on a cell with no movement arms a draw op anchored at that cell; pointermove from there extends the bounds; pointerup commits as today. A short tap selects an existing region as today.

**Pros**: single-finger UX preserved; gesture is invisible until used so it doesn't add chrome.

**Cons**: discoverability is essentially zero without a tutorial; iOS Safari's native long-press handlers (text selection, context menu, link preview) compete and can fire even with `touchAction` set, especially on cells whose contents are text; introduces a 350ms latency that feels broken to anyone who taps quickly to draw.

### Option D — Header-only region drawing on touch + body for selection only

The canvas already supports drawing whole-column and whole-row regions by dragging across the column/row headers (`handleGridPointerDown` lines 410-429). On touch, restrict drawing to that path: dragging in the body always pans; dragging on a header always draws a column/row band. To draw an arbitrary rectangle the user picks two cells via a "tap start corner → tap end corner" sequence.

**Pros**: no two-finger gymnastics; preserves single-finger pan; reuses an existing affordance.

**Cons**: changes the conceptual model on mobile vs desktop (rectangle drawing becomes a two-tap dialog rather than a drag), which is a fairly big behavioral split; awkward for diagonal regions; doesn't address region move/resize on touch.

## Recommendation (to confirm)

Lean toward **Option A as the primary mechanism + Option B's toggle as a fallback affordance**. Two-finger drag handles power users who can do it; the toggle is the rescue for users who can't, and doubles as the discoverability hint (a small "✋ Pan / ▢ Draw" pill in the top-left of the canvas, defaulting to Pan on touch and hidden on desktop).

This combo also makes region move/resize tractable: in Pan mode, tapping a region selects it and reveals enlarged drag handles (already exist via `RegionOverlayUI`); the handles can keep `touchAction: "none"` locally so drag still works without flipping mode.

## Open questions

- **Should desktop see the toggle at all?** Probably no by default — keep it touch-only — but a "show pan/draw toggle" preference for trackpad users may be worth it.
- **What about the segment dividers and resize handles' tap targets?** Today they're 8px wide. A finger is ≈ 44px. We will need a touch-only inflated hit-area (transparent padding around the visible chrome) regardless of which mode strategy wins. This applies to `RegionOverlay.component.tsx` resize handles and the divider boxes at `SheetCanvas.component.tsx:1454-1488`.
- **Do we keep edge-auto-scroll on touch?** With native pan in Pan mode, auto-scroll during a draw still matters (a two-finger draw can hit the screen edge). Worth keeping; no code change required.
- **How does pointer capture interact with `touchAction: pan-x pan-y`?** When the browser decides to pan, it fires `pointercancel` on captured pointers. The handlers must treat `pointercancel` as a clean abort (no draft committed). `handlePointerUp` is already wired to `onPointerCancel` — confirm there are no places where we assume only `pointerup` ever fires.
- **Two-finger draw anchor**: which finger is the start cell? Options: first finger down, the lower-and-left of the two, or the midpoint. First-finger-down is the only one that lets the user predict the result before placing the second finger.
- **Storybook / Jest coverage for touch**: the existing tests only fire mouse-shaped pointer events. We will need helpers that synthesize multi-pointer touch sequences (`pointerType: "touch"`, `isPrimary`, paired pointer ids) so the new logic can be tested without a real device.

## Affected files (rough)

- `apps/web/src/modules/RegionEditor/SheetCanvas.component.tsx` — primary changes (touch-action, pointer-down gating, mode state if Option B).
- `apps/web/src/modules/RegionEditor/RegionOverlay.component.tsx` — inflated hit-areas, body-tap-vs-drag decision on touch.
- `apps/web/src/modules/RegionEditor/RegionEditor.component.tsx` and `RegionDrawingStep.component.tsx` — if the mode toggle lives at this level rather than inside the canvas.
- `apps/web/src/modules/RegionEditor/__tests__/` — new touch-gesture coverage.
- `apps/web/src/modules/RegionEditor/stories/` — touch-mode story so the affordance is reviewable in Storybook.
