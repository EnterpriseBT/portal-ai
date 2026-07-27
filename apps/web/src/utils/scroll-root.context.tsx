import { createContext, useContext } from "react";

/**
 * The scroll container that wraps the portal message feed (#271). Provided by
 * `ChatWindowUI`; consumed by lazy-mounting visualization widgets as the
 * `root` for their `IntersectionObserver` (`useInView`). `null` when no
 * provider is present (e.g. Storybook, tests) — consumers fall back to the
 * browser viewport.
 */
export const ScrollRootContext = createContext<Element | null>(null);

export function useScrollRoot(): Element | null {
  return useContext(ScrollRootContext);
}
