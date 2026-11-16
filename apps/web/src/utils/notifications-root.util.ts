/** The notifications landmark's id: the skip link's target (#797). */
export const NOTIFICATIONS_ID = "notifications";

/**
 * Creates the page's one Notifications region and appends it to <body>
 * (#797). Toasts and the update notice both portal into it, so a keyboard
 * user reaches either through "Skip to notifications", and it's in the page
 * before anything is announced in it. Called once at startup (main.tsx, the
 * Storybook preview, the test setup), never during render. Idempotent.
 */
export function ensureNotificationsRoot(): HTMLElement {
  const existing = document.getElementById(NOTIFICATIONS_ID);
  if (existing) return existing;
  const region = document.createElement("section");
  region.id = NOTIFICATIONS_ID;
  region.setAttribute("aria-label", "Notifications");
  region.tabIndex = -1;
  region.style.outline = "none";
  document.body.appendChild(region);
  return region;
}

/** The Notifications region, or null where startup didn't create it; the
 *  caller then renders in place. A lookup only: safe during render. */
export function getNotificationsRoot(): HTMLElement | null {
  return typeof document === "undefined"
    ? null
    : document.getElementById(NOTIFICATIONS_ID);
}
