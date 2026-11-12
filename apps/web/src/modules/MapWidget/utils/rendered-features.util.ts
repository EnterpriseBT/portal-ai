import { renderPopupTemplate } from "./tile-source.util";

/** The parts of a `queryRenderedFeatures` result this list reads. */
export interface QueriedFeature {
  id?: string | number;
  layer: { id: string };
  source: string;
  sourceLayer?: string;
  properties: Record<string, unknown> | null;
  geometry: { type: string; coordinates?: unknown };
}

/** One entry in "Features in view" (#796). */
export interface RenderedFeature {
  key: string;
  layerId: string;
  /** Feature-state target: the feature's source, tile layer and id. */
  source: string;
  sourceLayer?: string;
  featureId?: string | number;
  label: string;
  properties: Record<string, unknown>;
  lngLat: [number, number];
}

export interface CollectOptions {
  /** The spec's popup template, which labels each item when present. */
  template?: string;
  /** Items listed; the rest are counted in `total`. */
  cap: number;
  /** MapLibre layer id → the column its colour encodes, so the label carries
   *  what the colour shows. */
  colorByForLayer?: Record<string, string | undefined>;
}

/** Items listed under a map at most (#796). */
export const RENDERED_FEATURE_CAP = 200;

const FALLBACK_FIELDS = 3;

/** djb2 over the sorted entries: a stable key for a feature with no id. */
function stableHash(props: Record<string, unknown>): string {
  const text = JSON.stringify(
    Object.keys(props)
      .sort()
      .map((k) => [k, props[k]])
  );
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

const stripTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isPlain = (v: unknown) =>
  v != null && (typeof v !== "object" || v instanceof Date);

function fallbackLabel(props: Record<string, unknown>): string {
  return Object.entries(props)
    .filter(([k, v]) => !k.startsWith("_") && isPlain(v))
    .slice(0, FALLBACK_FIELDS)
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(", ");
}

/** Every [lng, lat] pair in a GeoJSON coordinates array, at any depth. */
function* positions(coords: unknown): Generator<[number, number]> {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    yield [coords[0], coords[1]];
    return;
  }
  for (const c of coords) yield* positions(c);
}

function anchorOf(
  geometry: QueriedFeature["geometry"]
): [number, number] | null {
  if (geometry.type === "Point") {
    const [first] = positions(geometry.coordinates);
    return first ?? null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of positions(geometry.coordinates)) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/**
 * The features a map is drawing, as a deduplicated, capped list (#796).
 * A polygon draws as a fill and an outline layer, and a tiled feature can
 * appear once per tile it crosses, so items are keyed by source and feature
 * (its id, or a hash of its properties), never by MapLibre layer. Aggregate
 * bins (`_agg`) are a density summary, not features, and are skipped.
 */
export function collectRenderedFeatures(
  features: QueriedFeature[],
  opts: CollectOptions
): { items: RenderedFeature[]; total: number } {
  const seen = new Set<string>();
  const items: RenderedFeature[] = [];
  let total = 0;
  for (const f of features) {
    const props = f.properties ?? {};
    if ("_agg" in props) continue;
    const key = `${f.source}:${f.sourceLayer ?? ""}:${f.id ?? stableHash(props)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    total += 1;
    if (items.length >= opts.cap) continue;
    const lngLat = anchorOf(f.geometry);
    if (!lngLat) continue;

    let label = opts.template
      ? stripTags(renderPopupTemplate(opts.template, props))
      : fallbackLabel(props);
    const colorBy = opts.colorByForLayer?.[f.layer.id];
    if (colorBy && props[colorBy] != null && !label.includes(`${colorBy}: `)) {
      label += `${label ? " · " : ""}${colorBy}: ${String(props[colorBy])}`;
    }
    items.push({
      key,
      layerId: f.layer.id,
      source: f.source,
      sourceLayer: f.sourceLayer,
      featureId: f.id,
      label: label || "Feature",
      properties: props,
      lngLat,
    });
  }
  return { items, total };
}
