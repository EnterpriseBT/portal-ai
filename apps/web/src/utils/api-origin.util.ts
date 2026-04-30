/**
 * Origin allowlist for OAuth-popup postMessage handshakes.
 *
 * Derived from the API base URL so the popup's postMessage (which
 * comes from the API host where Google's redirect lands) is accepted
 * by the opener page. In dev, when `VITE_API_BASE_URL` is unset, falls
 * back to `"*"` — the popup hook then extracts the redirect URI's
 * origin from the consent URL itself, which is the same place the
 * postMessage will arrive from.
 */
export function apiOrigin(): string {
  const raw = import.meta.env.VITE_API_BASE_URL ?? "";
  try {
    return new URL(raw).origin;
  } catch {
    return "*";
  }
}
