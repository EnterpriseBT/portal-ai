import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";

/**
 * Post-login `returnTo` bridge (#585). A logged-out invitee who opens
 * `/invitations/accept?token=…` must land back there after the Auth0 round trip.
 * The router is created *inside* the Auth0 provider, so `onRedirectCallback`
 * can't navigate — it stashes the transaction's `returnTo` in sessionStorage and
 * this hook (mounted once inside the router) consumes it.
 *
 * Two single-use keys keep the phases separate:
 * - PRE: written by `Authorized` at the redirect-to-login, read by `LoginForm`
 *   to seed Auth0 `appState.returnTo`.
 * - POST: written by `onRedirectCallback` from that `appState`, read by the
 *   bridge to navigate once.
 */
export const PRE_LOGIN_RETURN_TO_KEY = "portalai-pre-login-returnto";
export const POST_LOGIN_RETURN_TO_KEY = "portalai-post-login-returnto";

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
 *  the user lands on "/" after login). Only same-origin app paths are kept. */
export function stashReturnTo(key: string, value: string): void {
  if (!value.startsWith("/")) return;
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // best-effort
  }
}

/**
 * Consume the post-login `returnTo` exactly once and navigate there. Clears the
 * key before navigating so a re-render (or the same value lingering) can't loop.
 */
export function usePostLoginReturnTo(): void {
  const navigate = useNavigate();
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current) return;
    const target = takeReturnTo(POST_LOGIN_RETURN_TO_KEY);
    if (!target) return;
    consumedRef.current = true;
    // Split the stashed href into path + search so a query-bearing target (the
    // accept link carries `?token=…`) survives — `to` alone treats the query as
    // part of the pathname.
    const url = new URL(target, window.location.origin);
    navigate({
      to: url.pathname,
      search: Object.fromEntries(url.searchParams.entries()),
    });
    // Run once on mount; the key is single-use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
