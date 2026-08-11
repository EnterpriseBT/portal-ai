/**
 * MapWidget — the MapLibre GL renderer for `geo` blocks (#314, epic #84).
 *
 * A declarative `MapSpec` (see `map-spec.contract.ts` in
 * `@portalai/core/contracts`) drives an interactive map: layers bound to a
 * geometry column or a lat/lng pair, styled with literals or MapLibre
 * expressions. `registerMapBlockRenderer()` (called at web bootstrap) plugs it
 * into core's open block-renderer registry; the widget itself is lazy so
 * `maplibre-gl` stays out of the main chunk.
 */

export { MapWidget, MapWidgetUI } from "./MapWidget.component";
export type { MapWidgetProps, MapWidgetUIProps } from "./MapWidget.component";

export {
  MapWidgetGate,
  MapWidgetPlaceholderUI,
} from "./MapWidgetGate.component";
export type {
  MapWidgetGateProps,
  MapWidgetPlaceholderUIProps,
} from "./MapWidgetGate.component";

export { registerMapBlockRenderer } from "./utils/register.util";

export {
  boundsOf,
  buildLegend,
  featuresForLayer,
  layerToMapLibre,
  resolveBasemapStyle,
  resolveColorBy,
  sourceIdFor,
} from "./utils/map-config.util";
export type {
  GeoFeature,
  GeoFeatureCollection,
  GradientStop,
  LayerData,
  LegendEntry,
  MapLegend,
} from "./utils/map-config.util";

export {
  EMPTY_TILE_STATUS,
  readTileStatus,
  renderPopupTemplate,
  tilePath,
  TILE_SOURCE_LAYER,
} from "./utils/tile-source.util";
export type { TileStatus } from "./utils/tile-source.util";

export {
  fetchTile,
  installPortalMapProtocol,
  protocolTileUrl,
  registerTileContext,
  TILE_PROTOCOL,
  unregisterTileContext,
} from "./utils/tile-protocol.util";
export type { TileContext } from "./utils/tile-protocol.util";
