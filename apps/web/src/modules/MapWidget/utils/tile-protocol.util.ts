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
 * Bound concurrent `portalmap://` tile fetches to the browser's ~per-host
 * connection ceiling (#350). A max-zoom-out view asks MapLibre for many tiles
 * at once, and each low-zoom aggregate tile is expensive; firing them all
 * saturates the connection pool and stalls the view. Tiles past the cap queue
 * and start as slots free; a superseded (aborted) *queued* tile is dropped
 * without ever spending a connection.
 */
const MAX_CONCURRENT_TILE_FETCHES = 6;
let activeTileFetches = 0;
const tileFetchQueue: Array<() => void> = [];

/**
 * #698: when the server answers `503 MAP_TILE_BUSY` its tile gate is
 * saturated. Every map in the tab shares that server, so the whole tab's tile
 * queue pauses for the `Retry-After` window instead of re-firing into a busy
 * gate — the client half of breaking the overload loop.
 */
let tileFetchesPausedUntil = 0;
const DEFAULT_RETRY_AFTER_MS = 2_000;
const MIN_RETRY_AFTER_MS = 1_000;
const MAX_RETRY_AFTER_MS = 30_000;

/** `Retry-After` (integer seconds) → milliseconds, clamped to [1s, 30s];
 *  2s when missing or unparseable. */
export function parseRetryAfter(value: string | null): number {
  const seconds = value === null ? NaN : Number.parseInt(value, 10);
  if (!Number.isFinite(seconds)) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(
    MAX_RETRY_AFTER_MS,
    Math.max(MIN_RETRY_AFTER_MS, seconds * 1_000)
  );
}

/** Hold new tile fetches for `ms`. A longer pause extends the window; a
 *  shorter one never shortens it. */
export function pauseTileFetches(ms: number): void {
  tileFetchesPausedUntil = Math.max(tileFetchesPausedUntil, Date.now() + ms);
}

/** Wait out any active pause (re-checking, since it may be extended).
 *  Rejects with `AbortError` if `signal` fires first. */
async function waitForTilePause(signal?: AbortSignal): Promise<void> {
  while (Date.now() < tileFetchesPausedUntil) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, tileFetchesPausedUntil - Date.now());
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

/** Acquire a fetch slot. Resolves immediately if under the cap, else waits in
 *  the queue. Rejects with `AbortError` if `signal` fires while still queued —
 *  a tile MapLibre no longer wants never starts a fetch. */
function acquireFetchSlot(signal?: AbortSignal): Promise<void> {
  if (activeTileFetches < MAX_CONCURRENT_TILE_FETCHES) {
    activeTileFetches += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const grant = () => {
      signal?.removeEventListener("abort", onAbort);
      activeTileFetches += 1;
      resolve();
    };
    const onAbort = () => {
      const i = tileFetchQueue.indexOf(grant);
      if (i >= 0) tileFetchQueue.splice(i, 1);
      reject(new DOMException("Aborted", "AbortError"));
    };
    tileFetchQueue.push(grant);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Release a held slot and hand it to the next queued tile, if any. */
function releaseFetchSlot(): void {
  activeTileFetches -= 1;
  const next = tileFetchQueue.shift();
  if (next) next();
}

/**
 * The protocol handler (extracted for testing). Splits the context id from the
 * real path, attaches the Bearer token, reports tile status, and returns the
 * bytes. 204/304 return empty bytes (a legitimately-empty tile); a failure
 * (timeout/4xx/5xx) throws so MapLibre retries rather than caching it empty,
 * with the notice already reported via `onStatus` (#449). Concurrency is capped
 * (#350) so a viewport burst can't saturate the connection pool.
 */
export async function fetchTile(
  url: string,
  signal: AbortSignal | undefined,
  deps: FetchTileDeps = {
    // Bound to globalThis — a bare `globalThis.fetch` reference loses its
    // receiver and throws "Illegal invocation" when called as `deps.fetch(…)`.
    fetch: globalThis.fetch.bind(globalThis),
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

  // #350: gate the network fetch behind the concurrency cap. Token resolution
  // stays outside so a slow first token doesn't hold a connection. Throws
  // AbortError if this tile was superseded while queued.
  await acquireFetchSlot(signal);
  try {
    // #698: honour a busy pause *after* taking the slot — a tile already
    // queued for a slot when the 503 arrived must wait it out too, not fire
    // into the busy gate the moment a slot frees. Inside the try so an abort
    // during the pause still releases the slot.
    await waitForTilePause(signal);
    const res = await deps.fetch(deps.resolveUrl(apiPath), {
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    ctx?.onStatus(readTileStatus(res.status, res.headers));

    // 204/304 are legitimately empty — return empty bytes so MapLibre caches an
    // (correctly) empty tile.
    // #698: the server's tile gate is saturated — pause the tab's tile queue
    // for its Retry-After window before this tile errors (and is retried).
    if (res.status === 503) {
      pauseTileFetches(parseRetryAfter(res.headers.get("Retry-After")));
    }
    if (res.status === 204 || res.status === 304) {
      return { data: new ArrayBuffer(0) };
    }
    // A genuine failure (timeout, 5xx, 4xx) must NOT be returned as empty bytes:
    // MapLibre would cache it as a valid empty tile and never retry, so the map
    // stays blank with no recovery. Throwing errors the tile, which MapLibre
    // retries on re-render (pan/zoom). The notice is already reported via
    // onStatus above. (#449)
    if (!res.ok) {
      throw new Error(`Tile fetch failed (${res.status})`);
    }
    return { data: await res.arrayBuffer() };
  } finally {
    releaseFetchSlot();
  }
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
      fetch: globalThis.fetch.bind(globalThis),
      registry: contexts,
      resolveUrl,
    })
  );
}
