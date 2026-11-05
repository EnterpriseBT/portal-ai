/** The notifications landmark's id: the skip link's target (#797). */
export const NOTIFICATIONS_ID = "notifications";

/**
 * The page's one Notifications region, created on first use and appended to
 * <body> (#797). Toasts and the update notice both portal into it, so a
 * keyboard user reaches either through "Skip to notifications", and it's in
 * the page before anything is announced in it. Idempotent: a second call
 * returns the same element.
 */
export function getNotificationsRoot(): HTMLElement {
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
