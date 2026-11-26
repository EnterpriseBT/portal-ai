import { useEffect, useState } from "react";

/**
 * `value`, once it has stopped changing for `ms` (#1076: the palette's
 * search). With `immediate`, the value passes through at once and the
 * pending one is dropped: the palette clears its search that way, so a
 * cleared or reopened palette never shows the previous search's results.
 */
export function useDebouncedValue<T>(
  value: T,
  ms: number,
  { immediate = false }: { immediate?: boolean } = {}
): T {
  const [debounced, setDebounced] = useState(value);
  // Adjusting state while rendering (React's documented pattern), so the
  // value lands in this render rather than one effect later.
  if (immediate && !Object.is(debounced, value)) setDebounced(value);
  useEffect(() => {
    if (immediate) return;
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms, immediate]);
  return immediate ? value : debounced;
}
