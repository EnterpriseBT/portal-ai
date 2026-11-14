/** A box in viewport coordinates, as `getBoundingClientRect` returns it. */
export interface ToastRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface ToastSize {
  width: number;
  height: number;
}

export type ToastStackEdge = "bottom" | "top";

const overlaps = (a: ToastRect, b: ToastRect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Where the toast stack sits for the focused element (#1024, WCAG 2.4.11).
 *
 * The stack lives `inset` px from the bottom-right corner. When the focused
 * box would be under it there, it moves to the top-right corner instead, so
 * focus is never hidden. It's measured against the bottom position, never
 * the current one, so the stack doesn't flip back and forth, and it stays at
 * the bottom when the top wouldn't clear the focused box either (a box as
 * tall as the page, like `main` after the skip link).
 */
export function toastStackEdge(
  focus: ToastRect | null,
  stack: ToastSize,
  viewport: ToastSize,
  inset: number
): ToastStackEdge {
  if (!focus || stack.width <= 0 || stack.height <= 0) return "bottom";
  const right = viewport.width - inset;
  const left = right - stack.width;
  const atBottom: ToastRect = {
    left,
    right,
    bottom: viewport.height - inset,
    top: viewport.height - inset - stack.height,
  };
  if (!overlaps(focus, atBottom)) return "bottom";
  const atTop: ToastRect = {
    left,
    right,
    top: inset,
    bottom: inset + stack.height,
  };
  return overlaps(focus, atTop) ? "bottom" : "top";
}
