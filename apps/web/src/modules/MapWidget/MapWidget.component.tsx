import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useTheme } from "@mui/material/styles";
import { useAuth0 } from "@auth0/auth0-react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { GeoBlockContentSchema } from "@portalai/core/contracts";

import { resolveApiUrl } from "../../utils/api.util";
import { useWidgetRefresh } from "../../utils/use-widget-refresh.util";
import {
  boundsOf,
  buildLegend,
  featuresForLayer,
  layerToMapLibre,
  resolveBasemapStyle,
} from "./utils/map-config.util";
import {
  EMPTY_TILE_STATUS,
  renderPopupTemplate,
  tilePath,
  TILE_SOURCE_LAYER,
  type TileStatus,
} from "./utils/tile-source.util";
import {
  installPortalMapProtocol,
  protocolTileUrl,
  registerTileContext,
  unregisterTileContext,
} from "./utils/tile-protocol.util";

import type { BlockRef } from "@portalai/core";
import type { GeoBlockContent, MapSpec } from "@portalai/core/contracts";
import type { LegendEntry } from "./utils/map-config.util";

const MAP_HEIGHT = 380;

// ── UI (pure — props only; `mode` and auth are passed in, not read here) ──

export interface MapWidgetUIProps {
  spec: MapSpec;
  rows: Record<string, unknown>[];
  mode: "light" | "dark";
  title?: string;
  loading?: boolean;
  error?: string | null;
  /** Real API tile template (`…/{z}/{x}/{y}.mvt`) for a large/handle result;
   *  present ⇒ render through vector tiles instead of inline GeoJSON. */
  tileTemplate?: string | null;
  /** Handle result with no server-addressable ref — can't tile; explain why. */
  largeUnpersisted?: boolean;
  getTileToken?: () => Promise<string | null>;
  resolveTileUrl?: (path: string) => string;
  /** Controlled tile-notice state (tests/stories); otherwise managed live. */
  tileStatus?: TileStatus;
  canRefresh?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  notRefreshable?: boolean;
  status?: "loading" | "ready" | "error" | "refreshing";
  onHeight?: (height: number) => void;
}

const STATUS_CHIP: Record<
  Exclude<NonNullable<MapWidgetUIProps["status"]>, "ready">,
  { label: string; color: "default" | "info" | "error" }
> = {
  loading: { label: "Loading", color: "default" },
  refreshing: { label: "Refreshing", color: "info" },
  error: { label: "Error", color: "error" },
};

export const MapWidgetUI: React.FC<MapWidgetUIProps> = ({
  spec,
  rows,
  mode,
  title,
  loading = false,
  error = null,
  tileTemplate = null,
  largeUnpersisted = false,
  getTileToken,
  resolveTileUrl = (p) => p,
  tileStatus,
  canRefresh = false,
  isRefreshing = false,
  onRefresh,
  notRefreshable = false,
  status = "ready",
  onHeight,
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  // React's useId() returns colon-wrapped ids (":r0:"); strip to URL-safe chars
  // because ctxId rides in the tile URL authority (`portalmap://<ctxId>/…`),
  // where a colon is invalid and silently breaks tile dispatch.
  const ctxId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [internalTileStatus, setInternalTileStatus] =
    useState<TileStatus>(EMPTY_TILE_STATUS);
  // A style/expression error thrown by MapLibre at addLayer time (row 9).
  const [renderError, setRenderError] = useState<string | null>(null);
  const tiles = tileStatus ?? internalTileStatus;

  const isTile = tileTemplate != null;

  // #337: a truncated line tile keeps the longest (major) features, not an
  // arbitrary subset — so its notice reads as "most prominent", not "partial".
  const hasLineLayer = spec.layers.some((l) => l.kind === "lines");

  // Pure spec→MapLibre translation (unit-tested in map-config.util.test).
  const { layerData, mlLayers, legend, bounds, featureCapNotice, hasFeatures } =
    useMemo(() => {
      const data = spec.layers.map((l, i) => featuresForLayer(l, i, rows));
      const layers = spec.layers.flatMap(
        (l, i) => layerToMapLibre(l, i, rows, { tiled: isTile }).layers
      );
      const lg: LegendEntry[] = buildLegend(spec, rows);
      const truncated = data.filter((d) => d.truncated);
      const shown = data.reduce((n, d) => n + d.collection.features.length, 0);
      const notice =
        truncated.length > 0
          ? `Showing the first ${shown.toLocaleString()} of ${truncated
              .reduce((n, d) => Math.max(n, d.total), 0)
              .toLocaleString()} features.`
          : null;
      return {
        layerData: data,
        mlLayers: layers,
        legend: lg,
        bounds: boundsOf(data.map((d) => d.collection)),
        featureCapNotice: notice,
        hasFeatures: data.some((d) => d.collection.features.length > 0),
      };
    }, [spec, rows, isTile]);

  const showMap = !error && (isTile || hasFeatures);

  useEffect(() => {
    if (!showMap || mapRef.current == null) return;
    setRenderError(null);
    let map: maplibregl.Map | null = null;

    if (isTile) {
      installPortalMapProtocol(maplibregl, resolveTileUrl);
      registerTileContext(ctxId, {
        getToken: getTileToken ?? (async () => null),
        onStatus: setInternalTileStatus,
      });
    }

    try {
      map = new maplibregl.Map({
        container: mapRef.current,
        style: resolveBasemapStyle(
          spec.basemap,
          mode
        ) as maplibregl.StyleSpecification,
        attributionControl: { compact: true },
      });
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right"
      );
      const m = map;
      const template = spec.popup?.template;

      m.on("load", () => {
        try {
          if (isTile) {
            m.addSource(ctxId, {
              type: "vector",
              tiles: [protocolTileUrl(ctxId, tileTemplate as string)],
              minzoom: 0,
              maxzoom: 22,
            } as never);
            mlLayers.forEach((l) =>
              m.addLayer({
                ...l,
                source: ctxId,
                "source-layer": TILE_SOURCE_LAYER,
              } as never)
            );
            if (typeof spec.initialView === "object") {
              m.jumpTo({
                center: spec.initialView.center,
                zoom: spec.initialView.zoom,
              });
            }
          } else {
            layerData.forEach((d) =>
              m.addSource(d.sourceId, {
                type: "geojson",
                data: d.collection as never,
              })
            );
            mlLayers.forEach((l) => m.addLayer(l as never));
            if (bounds)
              m.fitBounds(bounds, { padding: 32, animate: false, maxZoom: 15 });
          }
        } catch (e) {
          // A malformed style/expression MapLibre rejects at addLayer time (row 9).
          setRenderError(e instanceof Error ? e.message : "Invalid map style.");
          return;
        }
        for (const l of mlLayers) {
          m.on("mouseenter", l.id, () => {
            m.getCanvas().style.cursor = "pointer";
          });
          m.on("mouseleave", l.id, () => {
            m.getCanvas().style.cursor = "";
          });
          if (template) {
            m.on("click", l.id, (e) => {
              const f = e.features?.[0];
              if (!f) return;
              new maplibregl.Popup()
                .setLngLat(e.lngLat)
                .setHTML(renderPopupTemplate(template, f.properties ?? {}))
                .addTo(m);
            });
          }
        }
      });
      onHeight?.(MAP_HEIGHT);
    } catch {
      // Construction failure (e.g. no WebGL) — chrome still renders.
    }
    return () => {
      map?.remove();
      if (isTile) unregisterTileContext(ctxId);
    };
  }, [
    showMap,
    isTile,
    spec,
    rows,
    mode,
    tileTemplate,
    ctxId,
    getTileToken,
    resolveTileUrl,
    layerData,
    mlLayers,
    bounds,
    onHeight,
  ]);

  const chip = status !== "ready" ? STATUS_CHIP[status] : null;
  const header =
    title || canRefresh || chip ? (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
        {title ? (
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            {title}
          </Typography>
        ) : (
          <Box sx={{ flexGrow: 1 }} />
        )}
        {chip ? (
          <Chip size="small" label={chip.label} color={chip.color} />
        ) : null}
        {canRefresh && onRefresh ? (
          <Tooltip
            title={notRefreshable ? "This map can't refresh" : "Refresh map"}
          >
            <span>
              <IconButton
                size="small"
                aria-label="Refresh map"
                onClick={onRefresh}
                disabled={isRefreshing || notRefreshable}
              >
                {isRefreshing ? (
                  <CircularProgress size={16} />
                ) : (
                  <RefreshIcon fontSize="small" />
                )}
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
      </Box>
    ) : null;

  let body: React.ReactNode;
  const effectiveError = error ?? renderError;
  if (effectiveError) {
    body = (
      <Alert severity="error" data-testid="map-widget-error">
        {effectiveError}
      </Alert>
    );
  } else if (largeUnpersisted) {
    body = (
      <Alert severity="info" data-testid="map-widget-large-unpersisted">
        This result is too large to map inline. Pin it to explore it on a map.
      </Alert>
    );
  } else if (loading) {
    body = (
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          py: 4,
          justifyContent: "center",
        }}
      >
        <CircularProgress size={18} />
        <Typography variant="caption" color="text.secondary">
          Loading map…
        </Typography>
      </Box>
    );
  } else if (!isTile && !hasFeatures) {
    body = (
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="map-widget-empty"
        sx={{ py: 4, textAlign: "center" }}
      >
        No mappable features in this result.
      </Typography>
    );
  } else {
    body = (
      <>
        <Box
          ref={mapRef}
          data-testid="map-widget-canvas"
          sx={{
            width: "100%",
            height: MAP_HEIGHT,
            borderRadius: 1,
            overflow: "hidden",
          }}
        />
        {/* Visibility of limits — no quiet degradation (#314). */}
        {tiles.timedOut ? (
          <Typography
            variant="caption"
            color="error"
            data-testid="map-widget-tile-timeout"
          >
            A map tile timed out — pan or zoom to retry.
          </Typography>
        ) : null}
        {tiles.simplified ? (
          <Typography
            variant="caption"
            color="warning.main"
            data-testid="map-widget-simplified"
          >
            Simplified at this zoom — shapes are approximations. Zoom in for
            full detail.
          </Typography>
        ) : null}
        {tiles.aggregated ? (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="map-widget-aggregated"
          >
            Aggregated overview — zoom in for detail.
          </Typography>
        ) : tiles.truncated ? (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="map-widget-tile-truncated"
          >
            {hasLineLayer
              ? "Showing the most prominent features — zoom in for the rest."
              : "Partial at this zoom — zoom in for all features."}
          </Typography>
        ) : null}
        {featureCapNotice ? (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="map-widget-cap-notice"
          >
            {featureCapNotice}
          </Typography>
        ) : null}
        {legend.length > 0 ? (
          <Box
            data-testid="map-widget-legend"
            sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 0.5 }}
          >
            {legend.map((e) => (
              <Box
                key={e.label}
                sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
              >
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: "2px",
                    bgcolor: e.color,
                  }}
                />
                <Typography variant="caption">{e.label}</Typography>
              </Box>
            ))}
          </Box>
        ) : null}
      </>
    );
  }

  return (
    <Paper variant="outlined" data-testid="map-widget" sx={{ p: 1.5 }}>
      {header}
      {body}
    </Paper>
  );
};

// ── Container ──────────────────────────────────────────────────────────

export interface MapWidgetProps {
  content: GeoBlockContent | unknown;
  blockRef?: BlockRef;
  dataUpdatedAt?: number;
  onHeight?: (height: number) => void;
}

export const MapWidget: React.FC<MapWidgetProps> = ({
  content,
  blockRef,
  dataUpdatedAt,
  onHeight,
}) => {
  const muiTheme = useTheme();
  const mode = muiTheme.palette.mode === "dark" ? "dark" : "light";
  const { getAccessTokenSilently } = useAuth0();

  const parsed = useMemo(
    () => GeoBlockContentSchema.safeParse(content),
    [content]
  );
  const parsedContent = parsed.success ? parsed.data : null;

  const {
    fresh,
    isRefreshing,
    error: refreshError,
    notRefreshable,
    refresh,
  } = useWidgetRefresh(blockRef, dataUpdatedAt);

  const getTileToken = useMemo(
    () => async () => {
      try {
        return await getAccessTokenSilently({
          authorizationParams: {
            audience: import.meta.env.VITE_AUTH0_AUDIENCE,
          },
        });
      } catch {
        return null;
      }
    },
    [getAccessTokenSilently]
  );

  if (!parsedContent) {
    return (
      <MapWidgetUI
        spec={{ layers: [] } as unknown as MapSpec}
        rows={[]}
        mode={mode}
        error="Invalid map block content."
        status="error"
      />
    );
  }

  // A successful refresh's delivery overrides the persisted binding; the spec
  // always comes from the block itself.
  const freshInlineRows = fresh?.kind === "inline" ? fresh.rows : null;
  const isHandle =
    freshInlineRows == null &&
    (fresh?.kind === "handle" ||
      (fresh == null && "queryHandle" in parsedContent));
  const rows =
    freshInlineRows ??
    (fresh == null && "rows" in parsedContent ? parsedContent.rows : []);

  // Large result → vector tiles keyed to the block's own persisted ref.
  const tileTemplate = isHandle ? tilePath(blockRef) : null;

  const status: NonNullable<MapWidgetUIProps["status"]> = isRefreshing
    ? "refreshing"
    : refreshError
      ? "error"
      : "ready";

  return (
    <MapWidgetUI
      spec={parsedContent.spec}
      rows={rows}
      mode={mode}
      title={parsedContent.title}
      error={refreshError?.message ?? null}
      tileTemplate={tileTemplate}
      largeUnpersisted={isHandle && tileTemplate == null}
      getTileToken={getTileToken}
      resolveTileUrl={resolveApiUrl}
      canRefresh={blockRef != null && !notRefreshable}
      isRefreshing={isRefreshing}
      onRefresh={refresh}
      notRefreshable={notRefreshable}
      status={status}
      onHeight={onHeight}
    />
  );
};
