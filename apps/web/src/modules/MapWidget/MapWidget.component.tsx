import React, { useEffect, useMemo, useRef } from "react";
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
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { GeoBlockContentSchema } from "@portalai/core/contracts";

import { useWidgetRefresh } from "../../utils/use-widget-refresh.util";
import {
  boundsOf,
  buildLegend,
  featuresForLayer,
  layerToMapLibre,
  resolveBasemapStyle,
} from "./utils/map-config.util";

import type { BlockRef } from "@portalai/core";
import type { GeoBlockContent, MapSpec } from "@portalai/core/contracts";
import type { LegendEntry } from "./utils/map-config.util";

const MAP_HEIGHT = 380;

/** Mustache-ish popup fill — `{{field}}` → the feature's property. */
function renderTemplate(
  template: string,
  props: Record<string, unknown>
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = props[key];
    return v == null ? "" : String(v);
  });
}

// ── UI (pure — props only; `mode` is passed in, not read from context) ──

export interface MapWidgetUIProps {
  spec: MapSpec;
  rows: Record<string, unknown>[];
  mode: "light" | "dark";
  title?: string;
  loading?: boolean;
  error?: string | null;
  /** Handle-variant (large) block. Tile rendering lands in the next slice;
   *  until then a note explains why the map isn't drawn inline. */
  tilesPending?: boolean;
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
  tilesPending = false,
  canRefresh = false,
  isRefreshing = false,
  onRefresh,
  notRefreshable = false,
  status = "ready",
  onHeight,
}) => {
  const mapRef = useRef<HTMLDivElement>(null);

  // Pure spec→MapLibre translation (unit-tested in map-config.util.test).
  const { layerData, mlLayers, legend, bounds, featureCapNotice, hasFeatures } =
    useMemo(() => {
      const data = spec.layers.map((l, i) => featuresForLayer(l, i, rows));
      const layers = spec.layers.flatMap(
        (l, i) => layerToMapLibre(l, i, rows).layers
      );
      const lg: LegendEntry[] = buildLegend(spec, rows);
      const truncated = data.filter((d) => d.truncated);
      const notice =
        truncated.length > 0
          ? `Showing the first ${data.reduce((n, d) => n + d.collection.features.length, 0).toLocaleString()} of ${truncated.reduce((n, d) => Math.max(n, d.total), 0).toLocaleString()} features.`
          : null;
      return {
        layerData: data,
        mlLayers: layers,
        legend: lg,
        bounds: boundsOf(data.map((d) => d.collection)),
        featureCapNotice: notice,
        hasFeatures: data.some((d) => d.collection.features.length > 0),
      };
    }, [spec, rows]);

  const showMap = !error && !tilesPending && hasFeatures;

  // Mount MapLibre when there's something to draw. Rebuild on spec/rows/theme
  // change (simpler + correct vs. diffing sources). No-op in tests where the
  // module is mocked (the "load" callback never fires).
  useEffect(() => {
    if (!showMap || mapRef.current == null) return;
    let map: maplibregl.Map | null = null;
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
      map.on("load", () => {
        layerData.forEach((d) => {
          m.addSource(d.sourceId, {
            type: "geojson",
            data: d.collection as never,
          });
        });
        mlLayers.forEach((l) => m.addLayer(l as never));
        if (bounds)
          m.fitBounds(bounds, { padding: 32, animate: false, maxZoom: 15 });
        // Click → popup; pointer cursor over any interactive layer.
        const template = spec.popup?.template;
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
                .setHTML(renderTemplate(template, f.properties ?? {}))
                .addTo(m);
            });
          }
        }
      });
      onHeight?.(MAP_HEIGHT);
    } catch {
      // A construction failure (e.g. no WebGL) leaves the map area empty; the
      // widget chrome still renders. Never throw out of a render effect.
    }
    return () => map?.remove();
  }, [showMap, spec, rows, mode, layerData, mlLayers, bounds, onHeight]);

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
  if (error) {
    body = (
      <Alert severity="error" data-testid="map-widget-error">
        {error}
      </Alert>
    );
  } else if (tilesPending) {
    body = (
      <Alert severity="info" data-testid="map-widget-tiles-pending">
        This result is large and renders as vector tiles.
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
  } else if (!hasFeatures) {
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
      tilesPending={isHandle}
      canRefresh={blockRef != null && !notRefreshable}
      isRefreshing={isRefreshing}
      onRefresh={refresh}
      notRefreshable={notRefreshable}
      status={status}
      onHeight={onHeight}
    />
  );
};
