/**
 * Geometry shape translation for the REST-API adapter (#316).
 *
 * Pure leaf: no I/O. Translates the geometry shapes connectors actually
 * return into GeoJSON *geometry* objects so the wide-table write path can
 * hand them to `ST_GeomFromGeoJSON`. Shape translation only — reprojection
 * (a non-4326 source) is `ST_Transform`'s job in SQL, not this util's.
 *
 * Handled inputs:
 *   - ArcGIS polygon      `{ rings: [[[x,y],…],…] }`        → GeoJSON Polygon
 *   - ArcGIS polyline     `{ paths: [[[x,y],…],…] }`        → LineString / MultiLineString
 *   - ArcGIS point        `{ x, y }`                        → GeoJSON Point
 *   - GeoJSON geometry    `{ type, coordinates }`           → passthrough
 * Anything unrecognized returns `null`, and the audit then rejects the row.
 */

/** GeoJSON geometry types this util recognizes for passthrough. */
const GEOJSON_GEOMETRY_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A nested array of numeric coordinate positions (defensive — any depth). */
function isCoordinateArray(value: unknown): boolean {
  return Array.isArray(value);
}

/**
 * Translate a connector-returned geometry value into a GeoJSON geometry
 * object, or `null` if the value is not a geometry this util recognizes.
 * Shape translation only — the SRID/spatialReference is ignored here (a
 * non-4326 source is reprojected downstream via `ST_Transform`).
 */
export function toGeoJsonCandidate(value: unknown): unknown | null {
  if (!isRecord(value)) return null;

  // GeoJSON passthrough — a recognized `type` + `coordinates` (or a
  // GeometryCollection with `geometries`).
  if (
    typeof value.type === "string" &&
    GEOJSON_GEOMETRY_TYPES.has(value.type)
  ) {
    if (value.type === "GeometryCollection") {
      return Array.isArray(value.geometries) ? value : null;
    }
    return isCoordinateArray(value.coordinates) ? value : null;
  }

  // ArcGIS polygon — `rings` are exactly a GeoJSON Polygon's coordinate array.
  if (Array.isArray(value.rings)) {
    return { type: "Polygon", coordinates: value.rings };
  }

  // ArcGIS polyline — one path is a LineString; many paths a MultiLineString.
  if (Array.isArray(value.paths)) {
    const paths = value.paths as unknown[];
    if (paths.length === 1) {
      return { type: "LineString", coordinates: paths[0] };
    }
    return { type: "MultiLineString", coordinates: paths };
  }

  // ArcGIS point — `{ x, y }` (z/m ignored).
  if (typeof value.x === "number" && typeof value.y === "number") {
    return { type: "Point", coordinates: [value.x, value.y] };
  }

  return null;
}

/**
 * ESRI spatial-reference ids that are aliases for a different EPSG code.
 * ArcGIS reports web mercator as `wkid: 102100` (and legacy `102113`), which
 * PostGIS's `spatial_ref_sys` does NOT contain — the EPSG code is 3857. Passing
 * 102100 to ST_Transform would raise "unknown SRID", so map it here.
 */
const ESRI_SRID_ALIASES: Record<number, number> = {
  102100: 3857,
  102113: 3857,
};

/** True for the Esri-JSON geometry shapes (rings / paths / point) — NOT
 *  GeoJSON, which carries its CRS implicitly (always 4326) and has no
 *  `spatialReference` to stamp. */
function isEsriGeometryShape(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.rings) ||
    Array.isArray(value.paths) ||
    (typeof value.x === "number" && typeof value.y === "number")
  );
}

/**
 * Stamp a response-level `spatialReference` onto a record's Esri geometry
 * values (#316). Esri FeatureServer `/query?f=json` responses put
 * `spatialReference` at the response **root**, shared by every feature —
 * each feature's `geometry` is just `{rings|paths|x,y}` with no SRID of its
 * own. Without this, `extractSourceSrid` would default those to 4326 and a
 * non-4326 (e.g. web-mercator 102100) layer would be stored mislocated.
 *
 * Mutates `record` in place. A no-op for GeoJSON sources (RFC 7946 has no
 * `spatialReference` field and is always 4326) and when the root reference
 * carries no wkid, so it never touches standard-format data. Only stamps a
 * geometry that lacks its own `spatialReference`, so a per-feature reference
 * (if a source ever provides one) always wins.
 */
export function stampEsriSpatialReference(
  record: unknown,
  rootSpatialReference: unknown
): void {
  if (!isRecord(record) || !isRecord(rootSpatialReference)) return;
  const hasWkid =
    typeof rootSpatialReference.wkid === "number" ||
    typeof rootSpatialReference.latestWkid === "number";
  if (!hasWkid) return;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (isEsriGeometryShape(value) && value.spatialReference === undefined) {
      value.spatialReference = rootSpatialReference;
    }
  }
}

/**
 * Extract the source SRID of a connector-returned geometry value (#316).
 * ArcGIS carries it in `spatialReference` (`latestWkid` preferred — the modern
 * EPSG code — then `wkid`, with ESRI aliases normalized). GeoJSON has no CRS
 * field and is 4326 by definition (RFC 7946), which is also the default for an
 * unspecified reference.
 */
export function extractSourceSrid(value: unknown): number {
  if (isRecord(value) && isRecord(value.spatialReference)) {
    const sr = value.spatialReference;
    const raw =
      typeof sr.latestWkid === "number"
        ? sr.latestWkid
        : typeof sr.wkid === "number"
          ? sr.wkid
          : null;
    if (raw !== null) return ESRI_SRID_ALIASES[raw] ?? raw;
  }
  return 4326;
}

/**
 * Heuristic: does this value look like a geometry (ArcGIS or GeoJSON)? Used by
 * column inference to tag a column as `geometry`. A superset check — the
 * authoritative parse is `toGeoJsonCandidate` + the audit.
 */
export function looksLikeGeometry(value: unknown): boolean {
  return toGeoJsonCandidate(value) !== null;
}
