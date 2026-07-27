import { useEffect, useState, type RefObject } from "react";

/**
 * Default near-viewport band (#271): one viewport above and below the root. A
 * target within this band counts as "in view" (its widget mounts its live
 * render); beyond it, "out" (the widget tears its sandbox down). One generous
 * band bounds the live-iframe set without two-margin hysteresis machinery.
 */
export const UI_INVIEW_MARGIN = "100% 0px";

export interface UseInViewOptions {
  /** Observer root — typically the chat scroll container via `useScrollRoot()`.
   *  `null`/undefined → the browser viewport. */
  root?: Element | null;
  /** rootMargin band around the root. Default `UI_INVIEW_MARGIN`. */
  rootMargin?: string;
}

/**
 * Reports whether `ref`'s element is within `rootMargin` of the root. Starts
 * `false`; flips on the first `IntersectionObserver` callback. Reconnects when
 * `root`/`rootMargin` change. When `IntersectionObserver` is unavailable
 * (e.g. jsdom without a mock), returns `true` — fail-open, so content is never
 * hidden by a missing observer.
 */
export function useInView(
  ref: RefObject<Element | null>,
  opts: UseInViewOptions = {}
): boolean {
  const { root = null, rootMargin = UI_INVIEW_MARGIN } = opts;
  const hasIO = typeof IntersectionObserver !== "undefined";
  const [inView, setInView] = useState(!hasIO); // fail-open when no observer

  useEffect(() => {
    if (!hasIO) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry) setInView(entry.isIntersecting);
      },
      { root, rootMargin }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // ref is a stable container; re-observe only when root/margin change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, rootMargin, hasIO]);

  return inView;
}
