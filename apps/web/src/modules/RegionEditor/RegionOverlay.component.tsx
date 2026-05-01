import React from "react";
import { Box } from "@portalai/core/ui";

import { formatBounds } from "./utils/a1-notation.util";
import { colorForEntity } from "./utils/region-editor-colors.util";
import type { CellBounds, RegionDraft } from "./utils/region-editor.types";
import {
  orientationArrow,
  orientationArrowLabel,
  orientationFromDraft,
} from "./utils/region-orientation.util";

function hasDynamicTailPivot(
  region: RegionDraft,
  axis: "row" | "column"
): boolean {
  const segs = region.segmentsByAxis?.[axis] ?? [];
  if (segs.length === 0) return false;
  const tail = segs[segs.length - 1];
  return tail.kind === "pivot" && !!tail.dynamic;
}

export type ResizeHandleKind =
  | "nw"
  | "n"
  | "ne"
  | "w"
  | "e"
  | "sw"
  | "s"
  | "se";

export const ROW_HEADER_WIDTH = 44;
export const COL_HEADER_HEIGHT = 24;
const HANDLE_SIZE = 10;
// Inflated hit-area around the visible 10px handle. A finger is ~44px; the
// 24px wrapper gives enough padding for a touch to land reliably while the
// visible chrome (sized HANDLE_SIZE) stays unchanged on desktop. Mouse hits
// the wrapper just as well as the inner dot, so cursor / hover affordances
// continue to fire on the wrapper.
const HANDLE_HIT_SIZE = 24;
const HANDLE_DEFS: {
  kind: ResizeHandleKind;
  cursor: string;
  anchor: "start" | "middle" | "end";
  cross: "start" | "middle" | "end";
}[] = [
  { kind: "nw", cursor: "nwse-resize", anchor: "start", cross: "start" },
  { kind: "n", cursor: "ns-resize", anchor: "start", cross: "middle" },
  { kind: "ne", cursor: "nesw-resize", anchor: "start", cross: "end" },
  { kind: "w", cursor: "ew-resize", anchor: "middle", cross: "start" },
  { kind: "e", cursor: "ew-resize", anchor: "middle", cross: "end" },
  { kind: "sw", cursor: "nesw-resize", anchor: "end", cross: "start" },
  { kind: "s", cursor: "ns-resize", anchor: "end", cross: "middle" },
  { kind: "se", cursor: "nwse-resize", anchor: "end", cross: "end" },
];

export function computeResizedBounds(
  handle: ResizeHandleKind,
  original: CellBounds,
  current: { row: number; col: number }
): CellBounds {
  let { startRow, endRow, startCol, endCol } = original;

  if (handle.includes("n")) startRow = Math.min(current.row, original.endRow);
  if (handle.includes("s")) endRow = Math.max(current.row, original.startRow);
  if (handle.includes("w")) startCol = Math.min(current.col, original.endCol);
  if (handle.includes("e")) endCol = Math.max(current.col, original.startCol);

  if (startRow > endRow) [startRow, endRow] = [endRow, startRow];
  if (startCol > endCol) [startCol, endCol] = [endCol, startCol];

  return { startRow, endRow, startCol, endCol };
}

function anchorOffset(
  pos: "start" | "middle" | "end",
  startKey: "top" | "left",
  endKey: "bottom" | "right"
): Record<string, number | string> {
  const offset = -HANDLE_HIT_SIZE / 2;
  if (pos === "start") return { [startKey]: offset };
  if (pos === "end") return { [endKey]: offset };
  if (startKey === "top") {
    return { top: `calc(50% - ${HANDLE_HIT_SIZE / 2}px)` };
  }
  return { left: `calc(50% - ${HANDLE_HIT_SIZE / 2}px)` };
}

export interface RegionOverlayUIProps {
  region: RegionDraft;
  bounds: CellBounds;
  entityOrder: string[];
  selected: boolean;
  resizable: boolean;
  movable?: boolean;
  cellWidth: number;
  cellHeight: number;
  onBodyPointerDown: (
    regionId: string,
    originalBounds: CellBounds
  ) => (e: React.PointerEvent) => void;
  onResizeStart: (
    regionId: string,
    handle: ResizeHandleKind,
    originalBounds: CellBounds
  ) => (e: React.PointerEvent) => void;
}

export const RegionOverlayUI: React.FC<RegionOverlayUIProps> = ({
  region,
  bounds,
  entityOrder,
  selected,
  resizable,
  movable = false,
  cellWidth,
  cellHeight,
  onBodyPointerDown,
  onResizeStart,
}) => {
  const color = colorForEntity(region.targetEntityDefinitionId, entityOrder);
  const { drift } = region;
  const left = ROW_HEADER_WIDTH + bounds.startCol * cellWidth;
  const top = COL_HEADER_HEIGHT + bounds.startRow * cellHeight;
  const width = (bounds.endCol - bounds.startCol + 1) * cellWidth;
  const height = (bounds.endRow - bounds.startRow + 1) * cellHeight;
  const driftFlagged = Boolean(drift?.flagged);
  const orientation = orientationFromDraft(region);
  // A region's record axis can grow beyond the drawn bounds when
  // `recordAxisTerminator` is set, or when a tail pivot segment is
  // marked dynamic. The overlay renders a dashed edge on the growth
  // direction to signal that.
  const axes = region.headerAxes ?? [];
  const tailRowDynamic = hasDynamicTailPivot(region, "row");
  const tailColDynamic = hasDynamicTailPivot(region, "column");
  const axisGrows = (axis: "row" | "column"): boolean => {
    if (axes.length === 2) return axis === "row" ? tailRowDynamic : tailColDynamic;
    if (axes.length === 1) {
      const isRecordAxis =
        (axes[0] === "row" && axis === "column") ||
        (axes[0] === "column" && axis === "row");
      return isRecordAxis && !!region.recordAxisTerminator;
    }
    if (region.recordsAxis) {
      return region.recordsAxis === axis && !!region.recordAxisTerminator;
    }
    return false;
  };
  const extendsDown = axisGrows("column"); // column axis positions are rows
  const extendsRight = axisGrows("row"); // row axis positions are columns
  const extentBadge =
    region.recordAxisTerminator?.kind === "untilBlank"
      ? "UNTIL BLANK"
      : region.recordAxisTerminator?.kind === "matchesPattern"
        ? "MATCHES PATTERN"
        : null;

  return (
    <>
      <Box
        onPointerDown={onBodyPointerDown(region.id, bounds)}
        sx={{
          position: "absolute",
          left,
          top,
          width,
          height,
          border: "2px solid",
          borderColor: color,
          backgroundColor: `${color}1A`,
          cursor: movable && selected ? "move" : "pointer",
          zIndex: selected ? 6 : 5,
          boxShadow: selected ? `0 0 0 2px ${color}80` : undefined,
          borderBottomStyle: extendsDown ? "dashed" : "solid",
          borderRightStyle: extendsRight ? "dashed" : "solid",
          // The scroll container uses `pan-x pan-y` so empty cells pan
          // natively; the region body is a deliberate target, so it claims
          // every touch immediately and JS owns the move/select decision.
          touchAction: "none",
        }}
        aria-label={`Region ${region.proposedLabel ?? formatBounds(bounds)}`}
      >
        <Box
          sx={{
            position: "absolute",
            top: -22,
            left: 0,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            backgroundColor: color,
            color: "#fff",
            px: 0.75,
            py: 0.25,
            borderRadius: "4px 4px 0 0",
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: "nowrap",
            maxWidth: Math.max(width, 180),
          }}
        >
          <span
            aria-label={orientationArrowLabel(orientation)}
            title={orientationArrowLabel(orientation)}
            style={{ fontWeight: 700 }}
          >
            {orientationArrow(orientation)}
          </span>
          <span>
            {region.proposedLabel ??
              region.targetEntityLabel ??
              formatBounds(bounds)}
          </span>
          {extentBadge && (
            <span
              style={{
                backgroundColor: "#fff",
                color,
                borderRadius: 4,
                padding: "0 4px",
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {extentBadge}
            </span>
          )}
          {driftFlagged && (
            <span
              style={{
                backgroundColor: "#fff",
                color,
                borderRadius: 4,
                padding: "0 4px",
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              DRIFT
            </span>
          )}
        </Box>

        {selected &&
          resizable &&
          HANDLE_DEFS.map((h) => (
            <Box
              key={h.kind}
              aria-label={`Resize region ${h.kind}`}
              onPointerDown={onResizeStart(region.id, h.kind, bounds)}
              sx={{
                position: "absolute",
                width: HANDLE_HIT_SIZE,
                height: HANDLE_HIT_SIZE,
                cursor: h.cursor,
                zIndex: 7,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                // Local override against the scroll container's `pan-x pan-y`
                // so a finger on the handle never races the browser's pan.
                touchAction: "none",
                ...anchorOffset(h.anchor, "top", "bottom"),
                ...anchorOffset(h.cross, "left", "right"),
              }}
            >
              <Box
                aria-hidden
                sx={{
                  width: HANDLE_SIZE,
                  height: HANDLE_SIZE,
                  backgroundColor: "#fff",
                  border: "2px solid",
                  borderColor: color,
                  borderRadius: "2px",
                  pointerEvents: "none",
                }}
              />
            </Box>
          ))}
      </Box>
      {extendsDown && (
        <Box
          sx={{
            position: "absolute",
            left,
            top: top + height,
            width,
            height: 12,
            pointerEvents: "none",
            background: `linear-gradient(180deg, ${color}33 0%, transparent 100%)`,
            borderLeft: "2px dashed",
            borderRight: "2px dashed",
            borderColor: color,
            zIndex: selected ? 6 : 5,
          }}
        />
      )}
      {extendsRight && (
        <Box
          sx={{
            position: "absolute",
            left: left + width,
            top,
            width: 12,
            height,
            pointerEvents: "none",
            background: `linear-gradient(90deg, ${color}33 0%, transparent 100%)`,
            borderTop: "2px dashed",
            borderBottom: "2px dashed",
            borderColor: color,
            zIndex: selected ? 6 : 5,
          }}
        />
      )}
    </>
  );
};
