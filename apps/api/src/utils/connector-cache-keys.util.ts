/**
 * Slug-keyed Redis cache key helpers shared across connectors.
 *
 * Two short-lived caches:
 *   - workbook cache — chunked Redis layout for the parsed workbook,
 *     scoped to the editor session. The string returned by
 *     `workbookCacheKey()` is the **prefix** under which the chunked
 *     cache stores its sub-keys (`{prefix}:meta`,
 *     `{prefix}:sheet:{id}:rows:{n}`, `{prefix}:sheet:{id}:merges`).
 *     See `services/workbook-cache.service.ts`.
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
