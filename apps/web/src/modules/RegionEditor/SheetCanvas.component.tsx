import React, { useCallback, useMemo, useRef, useState } from "react";
import { Box, Stack, Typography } from "@portalai/core/ui";

import { colIndexToLetter, coordInBounds, formatBounds, normalizeBounds } from "./utils/a1-notation.util";
import { colorForEntity } from "./utils/region-editor-colors.util";
import {
  DECORATION_BACKGROUND_IMAGE,
  DECORATION_COLOR,
  computeRegionDecorations,
} from "./utils/region-editor-decorations.util";
import type { CellBounds, CellCoord, RegionDraft, SheetPreview } from "./utils/region-editor.types";

export interface SheetCanvasProps {
  sheet: SheetPreview;
  regions: RegionDraft[];
  entityOrder: string[];
  selectedRegionId: string | null;
  onRegionSelect: (regionId: string | null) => void;
  onRegionDraft: (bounds: CellBounds) => void;
  onRegionResize?: (regionId: string, nextBounds: CellBounds) => void;
  readOnly?: boolean;
  cellSize?: { width: number; height: number };
  maxHeight?: number;
}

const DEFAULT_CELL_WIDTH = 96;
const DEFAULT_CELL_HEIGHT = 28;
const ROW_HEADER_WIDTH = 44;
const COL_HEADER_HEIGHT = 24;

type ResizeHandleKind = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";

type ActiveOp =
  | { kind: "draw"; start: CellCoord; end: CellCoord }
  | {
      kind: "resize";
      regionId: string;
      handle: ResizeHandleKind;
      originalBounds: CellBounds;
      current: CellCoord;
    };

function computeResizedBounds(
  handle: ResizeHandleKind,
  original: CellBounds,
  current: CellCoord
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

export const SheetCanvas: React.FC<SheetCanvasProps> = ({
  sheet,
  regions,
  entityOrder,
  selectedRegionId,
  onRegionSelect,
  onRegionDraft,
  onRegionResize,
  readOnly = false,
  cellSize,
  maxHeight = 420,
}) => {
  const cellWidth = cellSize?.width ?? DEFAULT_CELL_WIDTH;
  const cellHeight = cellSize?.height ?? DEFAULT_CELL_HEIGHT;

  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeOp, setActiveOp] = useState<ActiveOp | null>(null);

  const clientToCell = useCallback(
    (clientX: number, clientY: number): CellCoord | null => {
      const grid = gridRef.current;
      if (!grid) return null;
      const rect = grid.getBoundingClientRect();
      const x = clientX - rect.left - ROW_HEADER_WIDTH;
      const y = clientY - rect.top - COL_HEADER_HEIGHT;
      const col = Math.max(0, Math.min(sheet.colCount - 1, Math.floor(x / cellWidth)));
      const row = Math.max(0, Math.min(sheet.rowCount - 1, Math.floor(y / cellHeight)));
      return { row, col };
    },
    [cellWidth, cellHeight, sheet.colCount, sheet.rowCount]
  );

  const capturePointer = useCallback((e: React.PointerEvent) => {
    try {
      scrollRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // jsdom and some touch backends can throw NotFoundError — non-fatal.
    }
  }, []);

  const handleCellPointerDown = useCallback(
    (coord: CellCoord, e: React.PointerEvent) => {
      if (readOnly) return;
      e.preventDefault();
      capturePointer(e);
      setActiveOp({ kind: "draw", start: coord, end: coord });
    },
    [readOnly, capturePointer]
  );

  const handleResizeStart = useCallback(
    (regionId: string, handle: ResizeHandleKind, originalBounds: CellBounds) =>
      (e: React.PointerEvent) => {
        if (readOnly) return;
        e.stopPropagation();
        e.preventDefault();
        capturePointer(e);
        const coord = clientToCell(e.clientX, e.clientY) ?? {
          row: originalBounds.startRow,
          col: originalBounds.startCol,
        };
        setActiveOp({ kind: "resize", regionId, handle, originalBounds, current: coord });
      },
    [readOnly, clientToCell, capturePointer]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!activeOp) return;
      const coord = clientToCell(e.clientX, e.clientY);
      if (!coord) return;
      setActiveOp((op) => {
        if (!op) return null;
        if (op.kind === "draw") {
          if (op.end.row === coord.row && op.end.col === coord.col) return op;
          return { ...op, end: coord };
        }
        if (op.kind === "resize") {
          if (op.current.row === coord.row && op.current.col === coord.col) return op;
          return { ...op, current: coord };
        }
        return op;
      });
    },
    [activeOp, clientToCell]
  );

  const handlePointerUp = useCallback(() => {
    if (!activeOp) return;
    if (activeOp.kind === "draw") {
      const bounds = normalizeBounds(activeOp.start, activeOp.end);
      const isSingleClick =
        bounds.startRow === bounds.endRow && bounds.startCol === bounds.endCol;
      if (!isSingleClick) {
        onRegionDraft(bounds);
      } else {
        const hit = regions.find(
          (r) => r.sheetId === sheet.id && coordInBounds(activeOp.start, r.bounds)
        );
        onRegionSelect(hit?.id ?? null);
      }
    } else if (activeOp.kind === "resize") {
      const next = computeResizedBounds(
        activeOp.handle,
        activeOp.originalBounds,
        activeOp.current
      );
      onRegionResize?.(activeOp.regionId, next);
    }
    setActiveOp(null);
  }, [activeOp, onRegionDraft, onRegionResize, onRegionSelect, regions, sheet.id]);

  const pendingBounds: CellBounds | null = useMemo(() => {
    if (!activeOp || activeOp.kind !== "draw") return null;
    return normalizeBounds(activeOp.start, activeOp.end);
  }, [activeOp]);

  const visibleRegions = useMemo(
    () => regions.filter((r) => r.sheetId === sheet.id),
    [regions, sheet.id]
  );

  const gridWidth = ROW_HEADER_WIDTH + cellWidth * sheet.colCount;

  return (
    <Box
      sx={{
        position: "relative",
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        backgroundColor: "background.paper",
        overflow: "hidden",
      }}
    >
      <Box
        ref={scrollRef}
        sx={{
          minWidth: 0,
          maxHeight,
          overflowX: "auto",
          overflowY: "auto",
          overscrollBehavior: "contain",
          userSelect: "none",
          touchAction: "none",
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <Box
          ref={gridRef}
          sx={{
            position: "relative",
            width: gridWidth,
            minWidth: "100%",
            display: "block",
          }}
        >
        {/* Column headers */}
        <Stack
          direction="row"
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 3,
            backgroundColor: "grey.100",
          }}
        >
          <Box
            sx={{
              width: ROW_HEADER_WIDTH,
              height: COL_HEADER_HEIGHT,
              borderRight: "1px solid",
              borderBottom: "1px solid",
              borderColor: "divider",
              flex: "0 0 auto",
            }}
          />
          {Array.from({ length: sheet.colCount }).map((_, col) => (
            <Box
              key={col}
              sx={{
                width: cellWidth,
                height: COL_HEADER_HEIGHT,
                borderRight: "1px solid",
                borderBottom: "1px solid",
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "0 0 auto",
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>
                {colIndexToLetter(col)}
              </Typography>
            </Box>
          ))}
        </Stack>

        {/* Rows */}
        {Array.from({ length: sheet.rowCount }).map((_, row) => (
          <Stack direction="row" key={row}>
            <Box
              sx={{
                width: ROW_HEADER_WIDTH,
                height: cellHeight,
                position: "sticky",
                left: 0,
                zIndex: 2,
                backgroundColor: "grey.100",
                borderRight: "1px solid",
                borderBottom: "1px solid",
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "0 0 auto",
              }}
            >
              <Typography variant="caption" sx={{ fontWeight: 600, color: "text.secondary" }}>
                {row + 1}
              </Typography>
            </Box>
            {Array.from({ length: sheet.colCount }).map((_, col) => {
              const value = sheet.cells[row]?.[col] ?? "";
              return (
                <Box
                  key={col}
                  data-testid={`cell-${row}-${col}`}
                  onPointerDown={(e) => handleCellPointerDown({ row, col }, e)}
                  sx={{
                    width: cellWidth,
                    height: cellHeight,
                    borderRight: "1px solid",
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    display: "flex",
                    alignItems: "center",
                    px: 0.75,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    flex: "0 0 auto",
                    cursor: readOnly ? "default" : "crosshair",
                    fontSize: 12,
                    fontFamily: "monospace",
                  }}
                >
                  {value === null || value === "" ? "" : String(value)}
                </Box>
              );
            })}
          </Stack>
        ))}

        {/* Decorations for the selected region (header / axis labels / skipped) */}
        {(() => {
          const selectedRegion = visibleRegions.find((r) => r.id === selectedRegionId);
          if (!selectedRegion) return null;
          const decorations = computeRegionDecorations(selectedRegion, sheet);
          return decorations.map((d, i) => {
            const dLeft = ROW_HEADER_WIDTH + d.bounds.startCol * cellWidth;
            const dTop = COL_HEADER_HEIGHT + d.bounds.startRow * cellHeight;
            const dWidth = (d.bounds.endCol - d.bounds.startCol + 1) * cellWidth;
            const dHeight = (d.bounds.endRow - d.bounds.startRow + 1) * cellHeight;
            return (
              <Box
                key={`deco-${i}`}
                title={d.label}
                sx={{
                  position: "absolute",
                  left: dLeft,
                  top: dTop,
                  width: dWidth,
                  height: dHeight,
                  backgroundColor: DECORATION_COLOR[d.kind],
                  backgroundImage: DECORATION_BACKGROUND_IMAGE[d.kind],
                  pointerEvents: "none",
                  zIndex: 4,
                }}
              />
            );
          });
        })()}

        {/* Region overlays */}
        {visibleRegions.map((region) => {
          const previewBounds =
            activeOp?.kind === "resize" && activeOp.regionId === region.id
              ? computeResizedBounds(activeOp.handle, activeOp.originalBounds, activeOp.current)
              : region.bounds;
          return (
            <RegionOverlay
              key={region.id}
              region={region}
              bounds={previewBounds}
              entityOrder={entityOrder}
              selected={region.id === selectedRegionId}
              resizable={!readOnly && Boolean(onRegionResize)}
              cellWidth={cellWidth}
              cellHeight={cellHeight}
              onClick={() => onRegionSelect(region.id)}
              onResizeStart={handleResizeStart}
            />
          );
        })}

        {/* Pending drag rectangle */}
        {pendingBounds && (
          <Box
            sx={{
              position: "absolute",
              left: ROW_HEADER_WIDTH + pendingBounds.startCol * cellWidth,
              top: COL_HEADER_HEIGHT + pendingBounds.startRow * cellHeight,
              width: (pendingBounds.endCol - pendingBounds.startCol + 1) * cellWidth,
              height: (pendingBounds.endRow - pendingBounds.startRow + 1) * cellHeight,
              border: "2px dashed",
              borderColor: "primary.main",
              backgroundColor: "rgba(37,99,235,0.08)",
              pointerEvents: "none",
              zIndex: 4,
            }}
          />
        )}
        </Box>
      </Box>
    </Box>
  );
};

interface RegionOverlayProps {
  region: RegionDraft;
  bounds: CellBounds;
  entityOrder: string[];
  selected: boolean;
  resizable: boolean;
  cellWidth: number;
  cellHeight: number;
  onClick: () => void;
  onResizeStart: (
    regionId: string,
    handle: ResizeHandleKind,
    originalBounds: CellBounds
  ) => (e: React.PointerEvent) => void;
}

const HANDLE_SIZE = 10;
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

const RegionOverlay: React.FC<RegionOverlayProps> = ({
  region,
  bounds,
  entityOrder,
  selected,
  resizable,
  cellWidth,
  cellHeight,
  onClick,
  onResizeStart,
}) => {
  const color = colorForEntity(region.targetEntityDefinitionId, entityOrder);
  const { drift, boundsMode = "absolute", orientation } = region;
  const left = ROW_HEADER_WIDTH + bounds.startCol * cellWidth;
  const top = COL_HEADER_HEIGHT + bounds.startRow * cellHeight;
  const width = (bounds.endCol - bounds.startCol + 1) * cellWidth;
  const height = (bounds.endRow - bounds.startRow + 1) * cellHeight;
  const driftFlagged = Boolean(drift?.flagged);
  const isDynamic = boundsMode !== "absolute";
  const extendsDown =
    isDynamic && (orientation === "rows-as-records" || orientation === "cells-as-records");
  const extendsRight =
    isDynamic && (orientation === "columns-as-records" || orientation === "cells-as-records");
  const extentBadge =
    boundsMode === "untilEmpty"
      ? "UNTIL EMPTY"
      : boundsMode === "matchesPattern"
        ? "MATCHES PATTERN"
        : null;

  return (
    <>
      <Box
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onClick();
        }}
        sx={{
          position: "absolute",
          left,
          top,
          width,
          height,
          border: "2px solid",
          borderColor: color,
          backgroundColor: `${color}1A`,
          cursor: "pointer",
          zIndex: selected ? 6 : 5,
          boxShadow: selected ? `0 0 0 2px ${color}80` : undefined,
          borderBottomStyle: extendsDown ? "dashed" : "solid",
          borderRightStyle: extendsRight ? "dashed" : "solid",
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
          <span>{region.proposedLabel ?? region.targetEntityLabel ?? formatBounds(bounds)}</span>
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

        {/* Resize handles — shown on the selected region */}
        {selected &&
          resizable &&
          HANDLE_DEFS.map((h) => (
            <Box
              key={h.kind}
              aria-label={`Resize region ${h.kind}`}
              onPointerDown={onResizeStart(region.id, h.kind, bounds)}
              sx={{
                position: "absolute",
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                backgroundColor: "#fff",
                border: "2px solid",
                borderColor: color,
                borderRadius: "2px",
                cursor: h.cursor,
                zIndex: 7,
                ...anchorOffset(h.anchor, "top", "bottom"),
                ...anchorOffset(h.cross, "left", "right"),
              }}
            />
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

function anchorOffset(
  pos: "start" | "middle" | "end",
  startKey: "top" | "left",
  endKey: "bottom" | "right"
): Record<string, number | string> {
  const offset = -HANDLE_SIZE / 2;
  if (pos === "start") return { [startKey]: offset };
  if (pos === "end") return { [endKey]: offset };
  if (startKey === "top") {
    return { top: `calc(50% - ${HANDLE_SIZE / 2}px)` };
  }
  return { left: `calc(50% - ${HANDLE_SIZE / 2}px)` };
}
