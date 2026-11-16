import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * Whether `ref`'s element scrolls: its content is wider or taller than its
 * box (#799). Re-measured when the element resizes and when `content`
 * changes. The comparison is axe's own (`scrollable-region-focusable`), so
 * a box axe would call scrollable is reported here too.
 */
export function useScrollOverflow<T extends HTMLElement>(
  ref: RefObject<T | null>,
  content: unknown
): boolean {
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setOverflowing(
        el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, content]);

  return overflowing;
}
