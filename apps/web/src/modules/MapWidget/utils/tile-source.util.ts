import type { BlockRef } from "@portalai/core";

/**
 * Vector-tile plumbing for the large-result path (#314, slice 5). A handle
 * `geo` block renders through #316's `ST_AsMVT` endpoint — the spatial analogue
 * of a query handle: the server holds the query, the client pages by z/x/y.
 */

/** The layer name #316 emits in `ST_AsMVT(q, 'default', …)`. MapLibre vector
 *  layers must set `source-layer` to this. */
export const TILE_SOURCE_LAYER = "default";

export interface TileStatus {
  /** A layer is generalized for the current zoom — shapes are approximations. */
  simplified: boolean;
  /** The density cap dropped features at this zoom. */
  truncated: boolean;
  /** A tile query hit `statement_timeout`. */
  timedOut: boolean;
}

export const EMPTY_TILE_STATUS: TileStatus = {
  simplified: false,
  truncated: false,
  timedOut: false,
};

/**
 * The real API tile path for a persisted block, with MapLibre's `{z}/{x}/{y}`
 * placeholders. `null` when the block has no server-addressable ref
 * (streaming/unpersisted) — a large map can't tile without a held pipeline.
 */
export function tilePath(ref: BlockRef | undefined): string | null {
  if (!ref) return null;
  const base =
    ref.kind === "message"
      ? `message/${ref.messageId}/${ref.blockIndex}`
      : `pin/${ref.portalResultId}`;
  return `/api/portal-map/tiles/${base}/{z}/{x}/{y}.mvt`;
}

/** Fold one tile response's status + headers into the notice state (#316 sets
 *  `X-Portal-Tile-Simplified` / `X-Portal-Tile-Truncated`; 504 on timeout). */
export function readTileStatus(
  status: number,
  headers: { get(name: string): string | null }
): TileStatus {
  return {
    simplified: headers.get("X-Portal-Tile-Simplified") != null,
    truncated: headers.get("X-Portal-Tile-Truncated") != null,
    timedOut: status === 504,
  };
}

/**
 * Mustache-ish popup fill. A field the feature lacks renders as `⟨field⟩`
 * (unresolved) rather than a blank popup — Visibility of limits, row 10.
 */
export function renderPopupTemplate(
  template: string,
  props: Record<string, unknown>
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = props[key];
    return v == null ? `⟨${key}⟩` : String(v);
  });
}
