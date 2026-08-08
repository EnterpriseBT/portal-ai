import React, { Suspense, useRef, useState } from "react";
import { Box } from "@mui/material";

import { useInView } from "../../utils/use-in-view.util";
import { useScrollRoot } from "../../utils/scroll-root.context";

import type { GeoBlockContent } from "@portalai/core/contracts";
import type { BlockRef } from "@portalai/core";

/**
 * Lazy the whole widget so `maplibre-gl` (~200 KB gzip) lands in its own async
 * chunk (the `manualChunks` entry in `vite.config.ts`) and never in the main
 * bundle — it loads only when a `geo` block first renders (#314).
 */
const MapWidget = React.lazy(() =>
  import("./MapWidget.component").then((m) => ({ default: m.MapWidget }))
);

/** Seed height before a widget has ever rendered (matches the map area). */
const PLACEHOLDER_SEED_HEIGHT = 400;

// ── Placeholder (pure) ─────────────────────────────────────────────────

export interface MapWidgetPlaceholderUIProps {
  height: number;
}

/** Height-preserving stand-in for an offscreen / not-yet-loaded widget — keeps
 *  scroll stable, mirroring the D3 gate (#271). */
export const MapWidgetPlaceholderUI: React.FC<MapWidgetPlaceholderUIProps> = ({
  height,
}) => (
  <Box
    data-testid="map-widget-placeholder"
    sx={{ width: "100%" }}
    style={{ height }}
  />
);

// ── Gate (container) ────────────────────────────────────────────────────

export interface MapWidgetGateProps {
  content: GeoBlockContent | unknown;
  blockRef?: BlockRef;
  dataUpdatedAt?: number;
}

/**
 * Mounts the live `MapWidget` only while near the viewport (bounding live
 * WebGL contexts on a long dashboard) and swaps a height-preserving
 * placeholder when far offscreen — the same session render-load management as
 * `D3WidgetGate` (#271). The Suspense fallback covers the lazy chunk load.
 */
export const MapWidgetGate: React.FC<MapWidgetGateProps> = ({
  content,
  blockRef,
  dataUpdatedAt,
}) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const root = useScrollRoot();
  const inView = useInView(frameRef, { root });
  const [lastHeight, setLastHeight] = useState(PLACEHOLDER_SEED_HEIGHT);

  return (
    <div ref={frameRef}>
      {inView ? (
        <Suspense fallback={<MapWidgetPlaceholderUI height={lastHeight} />}>
          <MapWidget
            content={content}
            blockRef={blockRef}
            dataUpdatedAt={dataUpdatedAt}
            onHeight={setLastHeight}
          />
        </Suspense>
      ) : (
        <MapWidgetPlaceholderUI height={lastHeight} />
      )}
    </div>
  );
};
