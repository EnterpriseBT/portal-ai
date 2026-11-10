import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Whether focus has nowhere meaningful to be (#795): on the page itself, or
 * on a container that holds `root` (the wizard dialog the step sits in).
 * That's where a browser leaves focus when the focused control unmounts,
 * and one Escape there dismisses the whole wizard.
 */
export function isFocusLost(root: HTMLElement | null): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active === document.body) return true;
  return !!root && active !== root && active.contains(root);
}

/** Frames to wait for a target that renders a little after the step. */
const MAX_FRAMES = 10;

/**
 * When a step mounts with focus lost (the previous step's button just
 * unmounted), focus `getTarget()`. Leaves focus alone when it's already
 * somewhere real.
 */
export function useFocusOnArrival(
  rootRef: RefObject<HTMLElement | null>,
  getTarget: () => HTMLElement | null | undefined
): void {
  const getTargetRef = useRef(getTarget);
  getTargetRef.current = getTarget;
  useEffect(() => {
    let frames = 0;
    let id = 0;
    const tick = () => {
      if (!isFocusLost(rootRef.current)) return;
      const target = getTargetRef.current();
      if (target) {
        target.focus();
        return;
      }
      if (++frames < MAX_FRAMES) id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [rootRef]);
}

/**
 * When a control inside `root` that had focus unmounts (Delete region,
 * + Add row axis), focus `getFallback()` instead of dropping to the
 * wizard. Checked after each commit: the last control focused inside
 * `root` is gone and focus is lost.
 */
export function useRestoreFocusOnRemoval(
  rootRef: RefObject<HTMLElement | null>,
  getFallback: () => HTMLElement | null | undefined
): void {
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onFocusIn = (e: FocusEvent) => {
      lastFocusedRef.current = e.target as HTMLElement;
    };
    root.addEventListener("focusin", onFocusIn);
    return () => root.removeEventListener("focusin", onFocusIn);
  }, [rootRef]);
  // No deps: every commit may have removed the focused control.
  useLayoutEffect(() => {
    const last = lastFocusedRef.current;
    if (!last || last.isConnected) return;
    if (!isFocusLost(rootRef.current)) return;
    lastFocusedRef.current = null;
    getFallback()?.focus();
  });
}
