/**
 * Slug-keyed Redis cache key helpers shared across connectors.
 *
 * Two short-lived caches:
 *   - workbook cache (parsed `WorkbookData`, scoped to the editor session)
 *   - access-token cache (the most recently refreshed OAuth access token)
 *
 * Keying by `<slug>` instead of a per-connector prefix means a new
 * connector lands without risk of squatting on an existing key namespace
 * — e.g. `connector:wb:microsoft-excel:abc` cannot collide with
 * `connector:wb:google-sheets:abc`.
 */

export function workbookCacheKey(
  slug: string,
  connectorInstanceId: string
): string {
  if (!slug) {
    throw new Error("workbookCacheKey: slug is required");
  }
  if (!connectorInstanceId) {
    throw new Error("workbookCacheKey: connectorInstanceId is required");
  }
  return `connector:wb:${slug}:${connectorInstanceId}`;
}

export function accessTokenCacheKey(
  slug: string,
  connectorInstanceId: string
): string {
  if (!slug) {
    throw new Error("accessTokenCacheKey: slug is required");
  }
  if (!connectorInstanceId) {
    throw new Error("accessTokenCacheKey: connectorInstanceId is required");
  }
  return `connector:access:${slug}:${connectorInstanceId}`;
}
