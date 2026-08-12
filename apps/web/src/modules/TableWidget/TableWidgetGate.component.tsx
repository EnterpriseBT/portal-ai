import React, { useRef, useState } from "react";
import { Box } from "@mui/material";

import { useInView } from "../../utils/use-in-view.util";
import { useScrollRoot } from "../../utils/scroll-root.context";
import { TableWidget } from "./TableWidget.component";

import type { DataTableBlockContent } from "@portalai/core/contracts";
import type { BlockRef } from "@portalai/core";

/** Seed height before a table has ever rendered — shorter than the d3 frame. */
const PLACEHOLDER_SEED_HEIGHT = 240;

// ── Placeholder (pure) ─────────────────────────────────────────────────

export interface TableWidgetPlaceholderUIProps {
  height: number;
}

/** Height-preserving stand-in for a torn-down widget — keeps scroll stable
 *  (#271). No chrome: an offscreen widget isn't visible; the table returns
 *  when it scrolls back into view and re-mounts. */
export const TableWidgetPlaceholderUI: React.FC<
  TableWidgetPlaceholderUIProps
> = ({ height }) => (
  <Box
    data-testid="table-widget-placeholder"
    sx={{ width: "100%" }}
    style={{ height }}
  />
);

// ── Gate (container) ────────────────────────────────────────────────────

export interface TableWidgetGateProps {
  content: DataTableBlockContent | unknown;
  blockRef?: BlockRef;
  dataUpdatedAt?: number;
}

/**
 * Session render-load management (#271, extended to tables in #349): mounts
 * the live `TableWidget` — and therefore its snapshot fetch and its
 * freshness-gated auto-refresh — only while near the viewport, swapping a
 * height-preserving placeholder when far offscreen. This is what keeps a long
 * thread of tables from all refreshing at once against the per-org rate cap.
 */
export const TableWidgetGate: React.FC<TableWidgetGateProps> = ({
  content,
  blockRef,
  dataUpdatedAt,
}) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const root = useScrollRoot();
  const inView = useInView(frameRef, { root });
  const [lastHeight] = useState(PLACEHOLDER_SEED_HEIGHT);

  return (
    <div ref={frameRef}>
      {inView ? (
        <TableWidget
          content={content}
          blockRef={blockRef}
          dataUpdatedAt={dataUpdatedAt}
        />
      ) : (
        <TableWidgetPlaceholderUI height={lastHeight} />
      )}
    </div>
  );
};
