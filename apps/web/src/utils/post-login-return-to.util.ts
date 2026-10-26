/**
 * Pre-login `returnTo` stash (#585). A logged-out invitee who opens
 * `/invitations/accept?token=…` must land back there after the Auth0 round
 * trip. `Authorized` stashes where the user was headed when it sends them to
 * login; the login call takes it into Auth0 `appState.returnTo`, and Auth0's
 * redirect callback returns the user there through the router (#884).
 */
export const PRE_LOGIN_RETURN_TO_KEY = "portalai-pre-login-returnto";

/** Read a returnTo value and remove it (single-use). Fail-safe: returns null
 *  when sessionStorage is unavailable or empty. */
export function takeReturnTo(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key);
    if (value) window.sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

/** Persist a returnTo value (best-effort — a value we can't stash just means
 *  the user lands on "/" after login). Only same-origin app paths are kept,
 *  never a protocol-relative `//host` (#884). */
export function stashReturnTo(key: string, value: string): void {
  if (!value.startsWith("/") || value.startsWith("//")) return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}
