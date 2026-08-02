import React, { useRef, useState } from "react";
import { Box } from "@mui/material";

import { useInView } from "../../utils/use-in-view.util";
import { useScrollRoot } from "../../utils/scroll-root.context";
import { D3Widget } from "./D3Widget.component";

import type { D3BlockContent } from "@portalai/core/contracts";
import type { BlockRef } from "@portalai/core";

/** Seed height before a widget has ever rendered (matches the sandbox frame). */
const PLACEHOLDER_SEED_HEIGHT = 360;

// ── Placeholder (pure) ─────────────────────────────────────────────────

export interface D3WidgetPlaceholderUIProps {
  height: number;
}

/** Height-preserving stand-in for a torn-down widget — keeps scroll stable
 *  (#271). No chrome: an offscreen widget isn't visible; the frame returns
 *  when it scrolls back into view and re-mounts. */
export const D3WidgetPlaceholderUI: React.FC<D3WidgetPlaceholderUIProps> = ({
  height,
}) => (
  <Box
    data-testid="d3-widget-placeholder"
    sx={{ width: "100%" }}
    style={{ height }}
  />
);

// ── Gate (container) ────────────────────────────────────────────────────

export interface D3WidgetGateProps {
  content: D3BlockContent | unknown;
  blockRef?: BlockRef;
  dataUpdatedAt?: number;
}

/**
 * Session render-load management (#271): mounts the live `D3Widget` (its data
 * paging + sandboxed iframe) only while near the viewport, and swaps a
 * height-preserving placeholder when far offscreen — bounding the number of
 * live iframes regardless of session length. Uses the chat scroll container
 * (`useScrollRoot`) as the observer root; falls back to the viewport.
 */
export const D3WidgetGate: React.FC<D3WidgetGateProps> = ({
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
        <D3Widget
          content={content}
          blockRef={blockRef}
          dataUpdatedAt={dataUpdatedAt}
          onHeight={setLastHeight}
        />
      ) : (
        <D3WidgetPlaceholderUI height={lastHeight} />
      )}
    </div>
  );
};
