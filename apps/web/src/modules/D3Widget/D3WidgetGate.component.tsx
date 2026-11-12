import React, { useId, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";

import { D3BlockContentSchema } from "@portalai/core/contracts";
import { visuallyHidden } from "@portalai/core/ui";
import { visualSummary } from "@portalai/core/utils";

import { useInView } from "../../utils/use-in-view.util";
import { useScrollRoot } from "../../utils/scroll-root.context";
import { D3Widget } from "./D3Widget.component";
import { toSummaryInput } from "../../utils/visual-summary-input.util";

import type { D3BlockContent } from "@portalai/core/contracts";
import type { BlockRef } from "@portalai/core";

/** Seed height before a widget has ever rendered (matches the sandbox frame). */
const PLACEHOLDER_SEED_HEIGHT = 360;

// ── Placeholder (pure) ─────────────────────────────────────────────────

export interface D3WidgetPlaceholderUIProps {
  height: number;
  /** #796: an offscreen chart still reads as the figure it stands in for. */
  title?: string;
  summary?: string;
}

/** Height-preserving stand-in for a torn-down widget — keeps scroll stable
 *  (#271). No chrome: an offscreen widget isn't visible; the frame returns
 *  when it scrolls back into view and re-mounts. */
export const D3WidgetPlaceholderUI: React.FC<D3WidgetPlaceholderUIProps> = ({
  height,
  title,
  summary,
}) => {
  const summaryId = useId();
  const figure = summary != null;
  return (
    <Box
      data-testid="d3-widget-placeholder"
      role={figure ? "figure" : undefined}
      aria-label={figure ? title?.trim() || "Chart" : undefined}
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

  // #796: what the placeholder announces, from the block alone.
  const named = useMemo(() => {
    const parsed = D3BlockContentSchema.safeParse(content);
    if (!parsed.success) return null;
    const block = parsed.data;
    const isPin = blockRef?.kind === "pin";
    return {
      title: block.title,
      summary: visualSummary(
        block.summary,
        toSummaryInput({
          kind: "chart",
          title: block.title,
          rows: !isPin && "rows" in block ? block.rows : null,
          handle: !isPin && "queryHandle" in block ? block : null,
        })
      ),
    };
  }, [content, blockRef]);

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
        <D3WidgetPlaceholderUI
          height={lastHeight}
          title={named?.title}
          summary={named?.summary}
        />
      )}
    </div>
  );
};
