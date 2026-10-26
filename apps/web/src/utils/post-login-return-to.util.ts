import { useSyncExternalStore } from "react";

/**
 * Post-login `returnTo` bridge (#585). A logged-out invitee who opens
 * `/invitations/accept?token=…` must land back there after the Auth0 round trip.
 * The router is created *inside* the Auth0 provider, so `onRedirectCallback`
 * can't navigate — it stashes the transaction's `returnTo` in sessionStorage and
 * `Authorized` consumes it once auth has settled (#884).
 *
 * Two single-use keys keep the phases separate:
 * - PRE: written by `Authorized` at the redirect-to-login, read by `LoginForm`
 *   to seed Auth0 `appState.returnTo`.
 * - POST: written by `onRedirectCallback` from that `appState`, read by
 *   `Authorized` to navigate once.
 */
export const PRE_LOGIN_RETURN_TO_KEY = "portalai-pre-login-returnto";
export const POST_LOGIN_RETURN_TO_KEY = "portalai-post-login-returnto";

/** Read a returnTo value without consuming it. Fail-safe: null when
 *  sessionStorage is unavailable or empty. */
export function peekReturnTo(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

// Subscribers to returnTo changes made through this module, so a component
// can render from a key and re-render when it's taken (#884).
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Read a returnTo value and remove it (single-use). Fail-safe: returns null
 *  when sessionStorage is unavailable or empty. */
export function takeReturnTo(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key);
    if (value) {
      window.sessionStorage.removeItem(key);
      notify();
    }
    return value;
  } catch {
    return null;
  }
}

/** The current value under `key`, re-rendering when this module takes it. */
export function useReturnTo(key: string): string | null {
  return useSyncExternalStore(subscribe, () => peekReturnTo(key));
}

/** Persist a returnTo value (best-effort — a value we can't stash just means
 *  the user lands on "/" after login). Only same-origin app paths are kept:
 *  never a protocol-relative `//host`, and never the login page itself, which
 *  `Authorized` sees on its way out to it (#884) and would otherwise overwrite
 *  the page the user was actually headed to. */
export function stashReturnTo(key: string, value: string): void {
  if (!value.startsWith("/") || value.startsWith("//")) return;
  if (value === "/login" || /^\/login[?#/]/.test(value)) return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}
