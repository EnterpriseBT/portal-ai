import { useEffect } from "react";

import { useRouter, useRouterState } from "@tanstack/react-router";

import { MAIN_CONTENT_ID } from "../components/SkipLinks.component";

export const APP_NAME = "Portals AI";

/** How long a navigation waits for the page's h1 before focusing main. */
export const FOCUS_FALLBACK_MS = 5_000;

/** The tab title for a page whose h1 reads `h1Text`. Only the page's own
 *  heading goes in: never the org name, since titles land in history. */
export function pageTitle(h1Text: string | null | undefined): string {
  const text = h1Text?.trim();
  return text ? `${text} · ${APP_NAME}` : APP_NAME;
}

/** The pathname announced last, across layouts: null until the first page.
 *  Module-level because a navigation can swap the layout (and so remount the
 *  hook), and that is still a navigation, not a first load. */
let lastPathname: string | null = null;
/** Where focus was when the current navigation started. */
let navigationOrigin: Element | null = null;

/** Test-only: forget the previous page, as on a fresh load. */
export function resetRouteAnnouncer(): void {
  lastPathname = null;
  navigationOrigin = null;
}

/** Focus `el` unless the user has moved focus since the navigation began. */
function focusIfUnmoved(el: HTMLElement): void {
  const active = document.activeElement;
  const unmoved =
    !active ||
    active === document.body ||
    active === navigationOrigin ||
    active.id === MAIN_CONTENT_ID;
  if (!unmoved) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus();
}

/**
 * Page titles and focus on route change (WCAG 2.4.2, 2.4.3; #797). Each
 * layout calls it.
 *
 * - The tab title follows the first h1 in `main#main-content`, including a
 *   later change to it (a detail page's name arriving after its data).
 * - After a client-side navigation (never on first load), focus moves to
 *   that h1 once it exists, or to main after FOCUS_FALLBACK_MS. It moves
 *   once per navigation, and only if focus is still where the navigation
 *   left it (the clicked link, body or main): a user who has already moved
 *   into a field or dialog keeps their place.
 */
export function useRouteAnnouncer(): void {
  const router = useRouter();
  // The resolved location changes once the new route has rendered;
  // `location` changes first, while the old page's h1 is still on screen.
  const pathname = useRouterState({
    select: (s) => s.resolvedLocation?.pathname ?? null,
  });

  useEffect(
    () =>
      router.subscribe("onBeforeNavigate", () => {
        navigationOrigin = document.activeElement;
      }),
    [router]
  );

  useEffect(() => {
    if (pathname === null) return;
    const isFirstLoad = lastPathname === null;
    const isNewPage = lastPathname !== pathname;
    lastPathname = pathname;
    let focusDone = isFirstLoad || !isNewPage;

    const main = () => document.getElementById(MAIN_CONTENT_ID);
    const sync = () => {
      const h1 = main()?.querySelector("h1") ?? null;
      const title = pageTitle(h1?.textContent);
      if (document.title !== title) document.title = title;
      if (!focusDone && h1) {
        focusDone = true;
        focusIfUnmoved(h1);
      }
    };

    const root = main();
    const observer = new MutationObserver(sync);
    if (root) {
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }
    sync();

    const fallback = focusDone
      ? undefined
      : setTimeout(() => {
          if (focusDone) return;
          focusDone = true;
          const m = main();
          if (m) focusIfUnmoved(m);
        }, FOCUS_FALLBACK_MS);

    return () => {
      observer.disconnect();
      if (fallback) clearTimeout(fallback);
    };
  }, [pathname]);
}
