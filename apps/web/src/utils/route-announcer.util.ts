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

/**
 * The navigation whose focus move is still owed. Module-level, not hook
 * state, so neither StrictMode's double effect run nor a navigation that
 * swaps the layout (and remounts the hook) can lose or repeat it: it's set
 * when a navigation starts and settles only once focus has been placed or
 * the user has moved it themselves.
 */
interface PendingFocus {
  /** The pathname the navigation goes to. */
  to: string;
  /** Where focus was when the navigation started (the clicked link). */
  origin: Element | null;
  /** The element focus was placed on, once it has been. */
  placed: HTMLElement | null;
  /** The user moved focus before it could be placed: leave it alone. */
  abandoned: boolean;
}

let pending: PendingFocus | null = null;

/** Test-only: forget any navigation in progress, as on a fresh load. */
export function resetRouteAnnouncer(): void {
  pending = null;
}

/** Whether focus is still where `nav` left it: nothing, the body, main, or
 *  the element the navigation started from. */
function focusUnmoved(nav: PendingFocus): boolean {
  const active = document.activeElement;
  return (
    !active ||
    active === document.body ||
    active === nav.origin ||
    active.id === MAIN_CONTENT_ID
  );
}

function focusOn(el: HTMLElement): void {
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
 *   that h1 once it exists, or to main after FOCUS_FALLBACK_MS, but only if
 *   focus is still where the navigation left it: a user who has already
 *   moved into a field or dialog keeps their place.
 * - Focus follows the heading: when the focused h1 is replaced (a loading
 *   placeholder swapped for the real PageHeader) and focus has dropped to
 *   the body, it moves to the new h1.
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
      router.subscribe("onBeforeNavigate", (event) => {
        // No previous location: the first load. Same path: a search or hash
        // change on the same page. Neither moves focus.
        if (!event.fromLocation || !event.pathChanged) return;
        pending = {
          to: event.toLocation.pathname,
          origin: document.activeElement,
          placed: null,
          abandoned: false,
        };
      }),
    [router]
  );

  useEffect(() => {
    if (pathname === null) return;
    const nav = pending && pending.to === pathname ? pending : null;

    const main = () => document.getElementById(MAIN_CONTENT_ID);
    const sync = () => {
      const h1 = main()?.querySelector("h1") ?? null;
      const title = pageTitle(h1?.textContent);
      if (document.title !== title) document.title = title;
      if (!nav || nav.abandoned || !h1) return;

      if (!nav.placed) {
        if (!focusUnmoved(nav)) {
          nav.abandoned = true;
          return;
        }
        focusOn(h1);
        nav.placed = h1;
        return;
      }
      // The heading focus was placed on is gone and focus fell to the body:
      // carry it to the heading that replaced it.
      const active = document.activeElement;
      if (
        nav.placed !== h1 &&
        !nav.placed.isConnected &&
        (!active || active === document.body)
      ) {
        focusOn(h1);
        nav.placed = h1;
      }
    };

    // Mutations come in bursts (a streamed reply, a table re-render): check
    // once per frame, not once per mutation.
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        sync();
      });
    };

    const root = main();
    const observer = new MutationObserver(schedule);
    if (root) {
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
      });
    }
    sync();

    const fallback =
      nav && !nav.placed && !nav.abandoned
        ? setTimeout(() => {
            if (nav.placed || nav.abandoned) return;
            const m = main();
            if (!m) return;
            if (!focusUnmoved(nav)) {
              nav.abandoned = true;
              return;
            }
            focusOn(m);
            nav.placed = m;
          }, FOCUS_FALLBACK_MS)
        : undefined;

    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (fallback) clearTimeout(fallback);
    };
  }, [pathname]);
}
