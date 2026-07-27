/**
 * The widget sizing rule (#278) — host-agnostic on purpose.
 *
 * The contract is **available width in, painted extent out, vertical fit
 * invariant**: a host supplies the width it has, the sandbox frame reports
 * what it actually painted (see `sandbox-bootstrap.js` → `measureContent`),
 * and this reconciles the two:
 *
 * - **Width** grows to the painted content when the visualization is
 *   intrinsically wider than the host's column, which is what lets the
 *   host's `overflowX: "auto"` wrapper engage as a horizontal scroller.
 *   It never falls below the container, so a narrow chart still fills it.
 * - **Height** is always the painted extent, unbounded. The widget fits its
 *   entire visualization and never scrolls vertically — in *every* host,
 *   which is why this is one shared rule rather than per-host policy.
 *
 * A second host (a custom dashboard tile) needs to supply a width and
 * nothing else.
 */

/** Width assumed before layout has settled, or if a container measures 0. */
export const FALLBACK_FRAME_WIDTH = 640;

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
 * A measurement is only usable if it's a real positive number — a frame
 * measuring a detached or zero-size root can report 0, NaN or Infinity, and
 * propagating that would collapse or blank the widget.
 */
const usable = (value?: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : undefined;

/** Reconcile host-available width with the frame's painted extent (#278). */
export function resolveFrameSize(input: FrameSizeInput): FrameSize {
  const container = usable(input.containerWidth) ?? FALLBACK_FRAME_WIDTH;
  const content = usable(input.contentWidth) ?? 0;

  return {
    width: Math.max(content, container),
    height: usable(input.contentHeight) ?? input.fallbackHeight,
  };
}
