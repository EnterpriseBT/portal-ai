import { readTileStatus, type TileStatus } from "./tile-source.util";

/**
 * A custom MapLibre protocol (`portalmap://`) so the widget owns the tile
 * fetch — MapLibre's built-in fetch exposes neither a place to attach the org
 * Bearer token nor the response headers we need for the "simplified" /
 * "partial" / "timeout" notices (#314, slice 5). The handler fetches the real
 * `/api/portal-map/...` URL with auth, folds the response into the notice
 * state, and returns the tile bytes.
 *
 * This is also *why the renderer is direct-mount rather than sandboxed*: the
 * org credential is handed to app code here, never to model-authored JS.
 */

export const TILE_PROTOCOL = "portalmap";

export interface TileContext {
  getToken: () => Promise<string | null>;
  onStatus: (status: TileStatus) => void;
}

// Keyed by a per-widget id encoded in the tile URL host, so one global protocol
// serves many maps. Registered on mount, cleared on unmount.
const contexts = new Map<string, TileContext>();

export function registerTileContext(id: string, ctx: TileContext): void {
  contexts.set(id, ctx);
}
export function unregisterTileContext(id: string): void {
  contexts.delete(id);
}

/** Wrap a real API tile template as a `portalmap://<ctxId>/…` URL. */
export function protocolTileUrl(contextId: string, apiPath: string): string {
  return `${TILE_PROTOCOL}://${contextId}${apiPath}`;
}

interface FetchTileDeps {
  fetch: typeof globalThis.fetch;
  registry: Map<string, TileContext>;
  /** Maps the relative `/api/…` path to a full URL (prod API base). Identity
   *  in dev (same-origin proxy). Injected so this util stays Vite-env-free. */
  resolveUrl: (path: string) => string;
}

/**
 * The protocol handler (extracted for testing). Splits the context id from the
 * real path, attaches the Bearer token, reports tile status, and returns the
 * bytes. 204/304/errors return empty bytes (the notice — timeout etc. — is
 * already reported via `onStatus`).
 */
export async function fetchTile(
  url: string,
  signal: AbortSignal | undefined,
  deps: FetchTileDeps = {
    fetch: globalThis.fetch,
    registry: contexts,
    resolveUrl: (p) => p,
  }
): Promise<{ data: ArrayBuffer }> {
  const rest = url.slice(`${TILE_PROTOCOL}://`.length);
  const slash = rest.indexOf("/");
  const ctxId = rest.slice(0, slash);
  const apiPath = rest.slice(slash);
  const ctx = deps.registry.get(ctxId);

  const token = ctx ? await ctx.getToken() : null;
  const res = await deps.fetch(deps.resolveUrl(apiPath), {
    signal,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  ctx?.onStatus(readTileStatus(res.status, res.headers));

  if (!res.ok || res.status === 204 || res.status === 304) {
    return { data: new ArrayBuffer(0) };
  }
  return { data: await res.arrayBuffer() };
}

let installed = false;

/** Register the protocol once (idempotent). Called from the widget mount with
 *  the app's API-base resolver so prod tiles hit the right host. */
export function installPortalMapProtocol(
  maplibre: {
    addProtocol: (
      scheme: string,
      handler: (
        params: { url: string },
        abortController: AbortController
      ) => Promise<{ data: ArrayBuffer }>
    ) => void;
  },
  resolveUrl: (path: string) => string
): void {
  if (installed) return;
  installed = true;
  maplibre.addProtocol(TILE_PROTOCOL, (params, abortController) =>
    fetchTile(params.url, abortController?.signal, {
      fetch: globalThis.fetch,
      registry: contexts,
      resolveUrl,
    })
  );
}
