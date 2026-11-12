import React, { Suspense, useId, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";

import { GeoBlockContentSchema } from "@portalai/core/contracts";
import { visuallyHidden } from "@portalai/core/ui";
import { visualSummary } from "@portalai/core/utils";

import { useInView } from "../../utils/use-in-view.util";
import { useScrollRoot } from "../../utils/scroll-root.context";
import { toSummaryInput } from "../../utils/visual-summary-input.util";

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
  /** #796: an offscreen map still reads as the figure it stands in for. */
  title?: string;
  summary?: string;
}

/** Height-preserving stand-in for an offscreen / not-yet-loaded widget — keeps
 *  scroll stable, mirroring the D3 gate (#271). */
export const MapWidgetPlaceholderUI: React.FC<MapWidgetPlaceholderUIProps> = ({
  height,
  title,
  summary,
}) => {
  const summaryId = useId();
  const figure = summary != null;
  return (
    <Box
      data-testid="map-widget-placeholder"
      role={figure ? "figure" : undefined}
      aria-label={figure ? title?.trim() || "Map" : undefined}
      aria-describedby={figure ? summaryId : undefined}
      sx={{ width: "100%" }}
      style={{ height }}
    >
      {figure ? (
        // Visually hidden: the placeholder is offscreen by definition.
        <Box component="span" id={summaryId} sx={visuallyHidden}>
          {summary}
        </Box>
      ) : null}
    </Box>
  );
};

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

  // #796: what the placeholder announces, from the block alone.
  const named = useMemo(() => {
    const parsed = GeoBlockContentSchema.safeParse(content);
    if (!parsed.success) return null;
    const block = parsed.data;
    const isPin = blockRef?.kind === "pin";
    return {
      title: block.title,
      summary: visualSummary(
        block.summary,
        toSummaryInput({
          kind: "map",
          title: block.title,
          spec: block.spec,
          rows: !isPin && "rows" in block && !block.tiled ? block.rows : null,
          handle: !isPin && "queryHandle" in block ? block : null,
        })
      ),
    };
  }, [content, blockRef]);
  const placeholder = (
    <MapWidgetPlaceholderUI
      height={lastHeight}
      title={named?.title}
      summary={named?.summary}
    />
  );

  return (
    <div ref={frameRef}>
      {inView ? (
        <Suspense fallback={placeholder}>
          <MapWidget
            content={content}
            blockRef={blockRef}
            dataUpdatedAt={dataUpdatedAt}
            onHeight={setLastHeight}
          />
        </Suspense>
      ) : (
        placeholder
      )}
    </div>
  );
};
