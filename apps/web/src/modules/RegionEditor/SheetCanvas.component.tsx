import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AnchorIcon from "@mui/icons-material/Anchor";
import { Box } from "@portalai/core/ui";
import { useVirtualizer } from "@tanstack/react-virtual";

import {
  COL_HEADER_HEIGHT,
  ROW_HEADER_WIDTH,
  RegionOverlayUI,
  computeResizedBounds,
  type ResizeHandleKind,
} from "./RegionOverlay.component";
import {
  colIndexToLetter,
  coordInBounds,
  normalizeBounds,
} from "./utils/a1-notation.util";
import {
  DECORATION_BACKGROUND_IMAGE,
  DECORATION_COLOR,
  computeRegionDecorations,
} from "./utils/region-editor-decorations.util";
import type {
  CellBounds,
  CellCoord,
  CellValue,
  RegionDraft,
  SheetPreview,
} from "./utils/region-editor.types";

/**
 * Fetches the cells inside the requested rectangle on the given sheet.
 * Returned `CellValue[][]` is indexed as `cells[row - rowStart][col - colStart]`.
 * The caller (canvas) is allowed to ask for rows beyond `sheet.rowCount`; the
 * backend clamps. A single loader instance serves every sheet in a workbook —
 * it receives the sheet id per call and closes over the upload session id.
 */
export type LoadSliceFn = (args: {
  sheetId: string;
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
}) => Promise<CellValue[][]>;

export interface SheetCanvasUIProps {
  sheet: SheetPreview;
  regions: RegionDraft[];
  entityOrder: string[];
  selectedRegionId: string | null;
  onRegionSelect: (regionId: string | null) => void;
  onRegionDraft: (bounds: CellBounds) => void;
  onRegionResize?: (regionId: string, nextBounds: CellBounds) => void;
  readOnly?: boolean;
  cellSize?: { width: number; height: number };
  maxHeight?: number | string;
  /**
   * When set, rows not already present in `sheet.cells` are treated as
   * "unloaded" and fetched on demand as they scroll into view. The fetched
   * cells are cached in-component for the sheet's lifetime. Omit for sheets
   * whose cells were inlined in the parse response.
   */
  loadSlice?: LoadSliceFn;
}

const DEFAULT_CELL_WIDTH = 96;
const DEFAULT_CELL_HEIGHT = 28;
const EDGE_SCROLL_ZONE = 36;
const MAX_EDGE_SCROLL_SPEED = 18;

type ActiveOp =
  | { kind: "draw"; start: CellCoord; end: CellCoord }
  | { kind: "drawColumns"; startCol: number; endCol: number }
  | { kind: "drawRows"; startRow: number; endRow: number }
  | {
      kind: "resize";
      regionId: string;
      handle: ResizeHandleKind;
      originalBounds: CellBounds;
      current: CellCoord;
    }
  | {
      kind: "move";
      regionId: string;
      originalBounds: CellBounds;
      pointerStart: CellCoord;
      current: CellCoord;
    };

function clampStart(start: number, span: number, max: number): number {
  if (start < 0) return 0;
  if (start + span > max) return max - span;
  return start;
}

function computeMovedBounds(
  original: CellBounds,
  pointerStart: CellCoord,
  current: CellCoord,
  rowCount: number,
  colCount: number
): CellBounds {
  const deltaRow = current.row - pointerStart.row;
  const deltaCol = current.col - pointerStart.col;
  const heightMinusOne = original.endRow - original.startRow;
  const widthMinusOne = original.endCol - original.startCol;
  const startRow = clampStart(
    original.startRow + deltaRow,
    heightMinusOne + 1,
    rowCount
  );
  const startCol = clampStart(
    original.startCol + deltaCol,
    widthMinusOne + 1,
    colCount
  );
  return {
    startRow,
    startCol,
    endRow: startRow + heightMinusOne,
    endCol: startCol + widthMinusOne,
  };
}

export const SheetCanvasUI: React.FC<SheetCanvasUIProps> = ({
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
  loadSlice,
}) => {
  const cellWidth = cellSize?.width ?? DEFAULT_CELL_WIDTH;
  const cellHeight = cellSize?.height ?? DEFAULT_CELL_HEIGHT;

  const gridRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollVelocityRef = useRef<{ vx: number; vy: number }>({
    vx: 0,
    vy: 0,
  });
  const [activeOp, setActiveOp] = useState<ActiveOp | null>(null);

  // Per-canvas slice cache for lazy-loaded sheets. Keyed by row index —
  // each entry is the row's cells across the full column range. Rests
  // alongside `sheet.cells` (which may be empty for sliced sheets) without
  // mutating it; the render path prefers inline cells when present.
  const [sliceCache, setSliceCache] = useState<Map<number, CellValue[]>>(
    () => new Map()
  );
  const pendingFetchesRef = useRef<Set<string>>(new Set());
  // Incremented when the sheet identity changes so late-arriving responses
  // from a previous sheet's fetches can be detected and dropped. Using a
  // version ref instead of a per-effect cleanup avoids falsely cancelling
  // a valid in-flight fetch whenever the fetch-trigger effect re-runs for
  // an unrelated reason (e.g. `virtualItems.length` shifting after the
  // virtualizer's first post-mount measurement).
  const sheetVersionRef = useRef(0);

  // Drop the cache (and invalidate in-flight fetches) when the sheet
  // identity changes — different sheet, different coordinate space.
  useEffect(() => {
    sheetVersionRef.current++;
    setSliceCache(new Map());
    pendingFetchesRef.current.clear();
  }, [sheet.id]);

  const clientToCell = useCallback(
    (clientX: number, clientY: number): CellCoord | null => {
      const grid = gridRef.current;
      if (!grid) return null;
      const rect = grid.getBoundingClientRect();
      const x = clientX - rect.left - ROW_HEADER_WIDTH;
      const y = clientY - rect.top - COL_HEADER_HEIGHT;
      const col = Math.max(
        0,
        Math.min(sheet.colCount - 1, Math.floor(x / cellWidth))
      );
      const row = Math.max(
        0,
        Math.min(sheet.rowCount - 1, Math.floor(y / cellHeight))
      );
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

  const applyPointerCoord = useCallback((coord: CellCoord) => {
    setActiveOp((op) => {
      if (!op) return op;
      if (op.kind === "draw") {
        if (op.end.row === coord.row && op.end.col === coord.col) return op;
        return { ...op, end: coord };
      }
      if (op.kind === "drawColumns") {
        if (op.endCol === coord.col) return op;
        return { ...op, endCol: coord.col };
      }
      if (op.kind === "drawRows") {
        if (op.endRow === coord.row) return op;
        return { ...op, endRow: coord.row };
      }
      if (op.kind === "resize") {
        if (op.current.row === coord.row && op.current.col === coord.col)
          return op;
        return { ...op, current: coord };
      }
      if (op.kind === "move") {
        if (op.current.row === coord.row && op.current.col === coord.col)
          return op;
        return { ...op, current: coord };
      }
      return op;
    });
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollFrameRef.current != null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
    autoScrollVelocityRef.current = { vx: 0, vy: 0 };
  }, []);

  // Always-current tick callback — the ref is only invoked inside
  // `requestAnimationFrame` handlers, so writing it in a layout-less effect
  // (which runs after commit) is safe and avoids a ref-during-render lint error.
  const runAutoScrollTickRef = useRef<() => void>(() => {});
  useEffect(() => {
    runAutoScrollTickRef.current = () => {
      const el = scrollRef.current;
      const { vx, vy } = autoScrollVelocityRef.current;
      if (!el || (vx === 0 && vy === 0)) {
        autoScrollFrameRef.current = null;
        return;
      }
      if (vx !== 0) el.scrollLeft += vx;
      if (vy !== 0) el.scrollTop += vy;
      const last = lastPointerRef.current;
      if (last) {
        const coord = clientToCell(last.x, last.y);
        if (coord) applyPointerCoord(coord);
      }
      autoScrollFrameRef.current = requestAnimationFrame(() =>
        runAutoScrollTickRef.current()
      );
    };
  });

  const updateAutoScroll = useCallback(
    (clientX: number, clientY: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const canScrollLeft = el.scrollLeft > 0;
      const canScrollRight =
        el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
      const canScrollUp = el.scrollTop > 0;
      const canScrollDown =
        el.scrollTop < el.scrollHeight - el.clientHeight - 1;

      const fromLeft = clientX - rect.left;
      const fromRight = rect.right - clientX;
      const fromTop = clientY - rect.top;
      const fromBottom = rect.bottom - clientY;

      let vx = 0;
      let vy = 0;
      if (fromLeft < EDGE_SCROLL_ZONE && canScrollLeft) {
        vx = -Math.ceil(
          ((EDGE_SCROLL_ZONE - fromLeft) / EDGE_SCROLL_ZONE) *
            MAX_EDGE_SCROLL_SPEED
        );
      } else if (fromRight < EDGE_SCROLL_ZONE && canScrollRight) {
        vx = Math.ceil(
          ((EDGE_SCROLL_ZONE - fromRight) / EDGE_SCROLL_ZONE) *
            MAX_EDGE_SCROLL_SPEED
        );
      }
      if (fromTop < EDGE_SCROLL_ZONE && canScrollUp) {
        vy = -Math.ceil(
          ((EDGE_SCROLL_ZONE - fromTop) / EDGE_SCROLL_ZONE) *
            MAX_EDGE_SCROLL_SPEED
        );
      } else if (fromBottom < EDGE_SCROLL_ZONE && canScrollDown) {
        vy = Math.ceil(
          ((EDGE_SCROLL_ZONE - fromBottom) / EDGE_SCROLL_ZONE) *
            MAX_EDGE_SCROLL_SPEED
        );
      }
      autoScrollVelocityRef.current = { vx, vy };
      if ((vx !== 0 || vy !== 0) && autoScrollFrameRef.current == null) {
        autoScrollFrameRef.current = requestAnimationFrame(() =>
          runAutoScrollTickRef.current()
        );
      } else if (vx === 0 && vy === 0 && autoScrollFrameRef.current != null) {
        stopAutoScroll();
      }
    },
    [stopAutoScroll]
  );

  useEffect(() => {
    return () => {
      if (autoScrollFrameRef.current != null) {
        cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    };
  }, []);

  const handleGridPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (readOnly) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-corner-header]")) {
        e.preventDefault();
        onRegionDraft({
          startRow: 0,
          endRow: sheet.rowCount - 1,
          startCol: 0,
          endCol: sheet.colCount - 1,
        });
        return;
      }
      const colHdr = target?.closest<HTMLElement>("[data-col-header]");
      if (colHdr) {
        const col = Number(colHdr.getAttribute("data-col-header"));
        if (!Number.isNaN(col)) {
          e.preventDefault();
          capturePointer(e);
          setActiveOp({ kind: "drawColumns", startCol: col, endCol: col });
        }
        return;
      }
      const rowHdr = target?.closest<HTMLElement>("[data-row-header]");
      if (rowHdr) {
        const row = Number(rowHdr.getAttribute("data-row-header"));
        if (!Number.isNaN(row)) {
          e.preventDefault();
          capturePointer(e);
          setActiveOp({ kind: "drawRows", startRow: row, endRow: row });
        }
        return;
      }
      const coord = clientToCell(e.clientX, e.clientY);
      if (!coord) return;
      e.preventDefault();
      capturePointer(e);
      setActiveOp({ kind: "draw", start: coord, end: coord });
    },
    [
      readOnly,
      capturePointer,
      clientToCell,
      onRegionDraft,
      sheet.rowCount,
      sheet.colCount,
    ]
  );

  const handleRegionBodyPointerDown = useCallback(
    (regionId: string, originalBounds: CellBounds) =>
      (e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        onRegionSelect(regionId);
        if (readOnly || !onRegionResize) return;
        capturePointer(e);
        const coord = clientToCell(e.clientX, e.clientY) ?? {
          row: originalBounds.startRow,
          col: originalBounds.startCol,
        };
        setActiveOp({
          kind: "move",
          regionId,
          originalBounds,
          pointerStart: coord,
          current: coord,
        });
      },
    [readOnly, onRegionResize, onRegionSelect, capturePointer, clientToCell]
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
        setActiveOp({
          kind: "resize",
          regionId,
          handle,
          originalBounds,
          current: coord,
        });
      },
    [readOnly, clientToCell, capturePointer]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!activeOp) return;
      lastPointerRef.current = { x: e.clientX, y: e.clientY };
      const coord = clientToCell(e.clientX, e.clientY);
      if (coord) applyPointerCoord(coord);
      updateAutoScroll(e.clientX, e.clientY);
    },
    [activeOp, clientToCell, applyPointerCoord, updateAutoScroll]
  );

  const handlePointerUp = useCallback(() => {
    stopAutoScroll();
    lastPointerRef.current = null;
    if (!activeOp) return;
    if (activeOp.kind === "draw") {
      const bounds = normalizeBounds(activeOp.start, activeOp.end);
      const isSingleClick =
        bounds.startRow === bounds.endRow && bounds.startCol === bounds.endCol;
      if (!isSingleClick) {
        onRegionDraft(bounds);
      } else {
        const hit = regions.find(
          (r) =>
            r.sheetId === sheet.id && coordInBounds(activeOp.start, r.bounds)
        );
        onRegionSelect(hit?.id ?? null);
      }
    } else if (activeOp.kind === "drawColumns") {
      const lo = Math.min(activeOp.startCol, activeOp.endCol);
      const hi = Math.max(activeOp.startCol, activeOp.endCol);
      onRegionDraft({
        startRow: 0,
        endRow: sheet.rowCount - 1,
        startCol: lo,
        endCol: hi,
      });
    } else if (activeOp.kind === "drawRows") {
      const lo = Math.min(activeOp.startRow, activeOp.endRow);
      const hi = Math.max(activeOp.startRow, activeOp.endRow);
      onRegionDraft({
        startRow: lo,
        endRow: hi,
        startCol: 0,
        endCol: sheet.colCount - 1,
      });
    } else if (activeOp.kind === "resize") {
      const next = computeResizedBounds(
        activeOp.handle,
        activeOp.originalBounds,
        activeOp.current
      );
      onRegionResize?.(activeOp.regionId, next);
    } else if (activeOp.kind === "move") {
      const moved =
        activeOp.current.row !== activeOp.pointerStart.row ||
        activeOp.current.col !== activeOp.pointerStart.col;
      if (moved) {
        const next = computeMovedBounds(
          activeOp.originalBounds,
          activeOp.pointerStart,
          activeOp.current,
          sheet.rowCount,
          sheet.colCount
        );
        onRegionResize?.(activeOp.regionId, next);
      }
    }
    setActiveOp(null);
  }, [
    activeOp,
    onRegionDraft,
    onRegionResize,
    onRegionSelect,
    regions,
    sheet.id,
    sheet.rowCount,
    sheet.colCount,
    stopAutoScroll,
  ]);

  const pendingBounds: CellBounds | null = useMemo(() => {
    if (!activeOp) return null;
    if (activeOp.kind === "draw") {
      return normalizeBounds(activeOp.start, activeOp.end);
    }
    if (activeOp.kind === "drawColumns") {
      return {
        startRow: 0,
        endRow: sheet.rowCount - 1,
        startCol: Math.min(activeOp.startCol, activeOp.endCol),
        endCol: Math.max(activeOp.startCol, activeOp.endCol),
      };
    }
    if (activeOp.kind === "drawRows") {
      return {
        startRow: Math.min(activeOp.startRow, activeOp.endRow),
        endRow: Math.max(activeOp.startRow, activeOp.endRow),
        startCol: 0,
        endCol: sheet.colCount - 1,
      };
    }
    return null;
  }, [activeOp, sheet.rowCount, sheet.colCount]);

  const visibleRegions = useMemo(
    () => regions.filter((r) => r.sheetId === sheet.id),
    [regions, sheet.id]
  );

  const gridWidth = ROW_HEADER_WIDTH + cellWidth * sheet.colCount;

  // Virtualize the data-row dimension. The sticky column-header row and the
  // per-row sticky row-header column stay rendered for every visible row;
  // region overlays are absolutely positioned against the full grid so they
  // stay at the correct coordinates even when their row is scrolled out of
  // the virtualized viewport.
  //
  // `initialRect` provides a sane default viewport size so that the first
  // render produces a visible range. The custom `observeElementRect` reads
  // real `getBoundingClientRect` in production, but falls back to
  // `initialRect` when a dimension is zero — the case jsdom produces, and
  // also the case before the scroll element is laid out.
  const initialRectHeight = typeof maxHeight === "number" ? maxHeight : 600;
  const initialRect = useMemo(
    () => ({ width: gridWidth, height: initialRectHeight }),
    [gridWidth, initialRectHeight]
  );
  const rowVirtualizer = useVirtualizer({
    count: sheet.rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => cellHeight,
    overscan: 8,
    paddingStart: COL_HEADER_HEIGHT,
    initialRect,
    observeElementRect: (instance, cb) => {
      const el = instance.scrollElement as HTMLElement | null;
      if (!el) return () => {};
      const measure = () => {
        const rect = el.getBoundingClientRect();
        cb({
          width: rect.width || initialRect.width,
          height: rect.height || initialRect.height,
        });
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    },
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const firstVisibleRow = virtualItems[0]?.index ?? 0;
  const lastVisibleRow =
    virtualItems[virtualItems.length - 1]?.index ?? firstVisibleRow;

  // Fetch cells for visible rows whose data isn't already inline or cached.
  // The fetched rectangle spans the full column range — users scan rows much
  // more than columns, and the backend's 50k-cell cap comfortably covers a
  // viewport-height of rows across hundreds of columns. `pendingFetchesRef`
  // suppresses duplicate requests across re-renders while a fetch is in
  // flight for the same rectangle.
  useEffect(() => {
    if (!loadSlice) return;
    if (virtualItems.length === 0) return;
    let anyMissing = false;
    for (let r = firstVisibleRow; r <= lastVisibleRow; r++) {
      if (sheet.cells[r] === undefined && !sliceCache.has(r)) {
        anyMissing = true;
        break;
      }
    }
    if (!anyMissing) return;
    const rectKey = `${sheet.id}:${firstVisibleRow}-${lastVisibleRow}`;
    if (pendingFetchesRef.current.has(rectKey)) return;
    pendingFetchesRef.current.add(rectKey);
    const fetchedAtVersion = sheetVersionRef.current;
    loadSlice({
      sheetId: sheet.id,
      rowStart: firstVisibleRow,
      rowEnd: lastVisibleRow,
      colStart: 0,
      colEnd: Math.max(0, sheet.colCount - 1),
    })
      .then((cells) => {
        pendingFetchesRef.current.delete(rectKey);
        if (fetchedAtVersion !== sheetVersionRef.current) return;
        setSliceCache((prev) => {
          const next = new Map(prev);
          for (let i = 0; i < cells.length; i++) {
            next.set(firstVisibleRow + i, cells[i] ?? []);
          }
          return next;
        });
      })
      .catch(() => {
        pendingFetchesRef.current.delete(rectKey);
      });
  }, [
    loadSlice,
    firstVisibleRow,
    lastVisibleRow,
    sheet.id,
    sheet.cells,
    sheet.colCount,
    sliceCache,
    virtualItems.length,
  ]);

  const headerCursor = readOnly ? "default" : "pointer";
  const colHeaderStyle: React.CSSProperties = useMemo(
    () => ({
      width: cellWidth,
      height: COL_HEADER_HEIGHT,
      borderRight: "1px solid #e5e7eb",
      borderBottom: "1px solid #e5e7eb",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 auto",
      fontSize: 11,
      fontWeight: 600,
      color: "rgba(0,0,0,0.6)",
      boxSizing: "border-box",
      cursor: headerCursor,
    }),
    [cellWidth, headerCursor]
  );
  const rowHeaderStyle: React.CSSProperties = useMemo(
    () => ({
      width: ROW_HEADER_WIDTH,
      height: cellHeight,
      position: "sticky",
      left: 0,
      zIndex: 2,
      background: "#f3f4f6",
      borderRight: "1px solid #e5e7eb",
      borderBottom: "1px solid #e5e7eb",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flex: "0 0 auto",
      fontSize: 11,
      fontWeight: 600,
      color: "rgba(0,0,0,0.6)",
      boxSizing: "border-box",
      cursor: headerCursor,
    }),
    [cellHeight, headerCursor]
  );
  const cellStyle: React.CSSProperties = useMemo(
    () => ({
      width: cellWidth,
      height: cellHeight,
      borderRight: "1px solid #e5e7eb",
      borderBottom: "1px solid #e5e7eb",
      display: "flex",
      alignItems: "center",
      paddingLeft: 6,
      paddingRight: 6,
      overflow: "hidden",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
      flex: "0 0 auto",
      cursor: readOnly ? "default" : "crosshair",
      fontSize: 12,
      fontFamily: "monospace",
      boxSizing: "border-box",
    }),
    [cellWidth, cellHeight, readOnly]
  );

  const colHeaderRow = useMemo(() => {
    const cells: React.ReactElement[] = [];
    for (let col = 0; col < sheet.colCount; col++) {
      cells.push(
        <div key={col} data-col-header={col} style={colHeaderStyle}>
          {colIndexToLetter(col)}
        </div>
      );
    }
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          position: "sticky",
          top: 0,
          zIndex: 3,
          background: "#f3f4f6",
          width: gridWidth,
        }}
      >
        <div
          data-corner-header=""
          style={{
            width: ROW_HEADER_WIDTH,
            height: COL_HEADER_HEIGHT,
            borderRight: "1px solid #e5e7eb",
            borderBottom: "1px solid #e5e7eb",
            flex: "0 0 auto",
            boxSizing: "border-box",
            cursor: headerCursor,
            position: "sticky",
            left: 0,
            zIndex: 4,
            background: "#f3f4f6",
          }}
          aria-label="Select entire sheet"
        />
        {cells}
      </div>
    );
  }, [sheet.colCount, colHeaderStyle, gridWidth, headerCursor]);

  const placeholderCellStyle: React.CSSProperties = useMemo(
    () => ({ ...cellStyle, color: "rgba(0,0,0,0.25)" }),
    [cellStyle]
  );

  const renderRow = useCallback(
    (rowIndex: number, top: number, size: number): React.ReactElement => {
      const inlineRow = sheet.cells[rowIndex];
      const cachedRow = sliceCache.get(rowIndex);
      // "Unloaded" = no inline data, no cached data, and a lazy loader
      // exists. Without a loader an unloaded row is just empty, not pending.
      const rowIsUnloaded =
        inlineRow === undefined && cachedRow === undefined && Boolean(loadSlice);
      const cellEls: React.ReactElement[] = [];
      for (let col = 0; col < sheet.colCount; col++) {
        let display = "";
        if (inlineRow !== undefined) {
          const raw = inlineRow[col];
          display =
            raw === null || raw === undefined || raw === "" ? "" : String(raw);
        } else if (cachedRow !== undefined) {
          const raw = cachedRow[col];
          display =
            raw === null || raw === undefined || raw === "" ? "" : String(raw);
        } else if (rowIsUnloaded) {
          display = "…";
        }
        cellEls.push(
          <div
            key={col}
            data-testid={`cell-${rowIndex}-${col}`}
            style={rowIsUnloaded ? placeholderCellStyle : cellStyle}
            aria-busy={rowIsUnloaded || undefined}
          >
            {display}
          </div>
        );
      }
      return (
        <div
          key={rowIndex}
          style={{
            position: "absolute",
            top,
            left: 0,
            height: size,
            width: gridWidth,
            display: "flex",
            flexDirection: "row",
          }}
        >
          <div data-row-header={rowIndex} style={rowHeaderStyle}>
            {rowIndex + 1}
          </div>
          {cellEls}
        </div>
      );
    },
    [
      sheet.cells,
      sheet.colCount,
      cellStyle,
      placeholderCellStyle,
      rowHeaderStyle,
      gridWidth,
      sliceCache,
      loadSlice,
    ]
  );

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
        <div
          ref={gridRef}
          onPointerDown={handleGridPointerDown}
          style={{
            position: "relative",
            width: gridWidth,
            minWidth: "100%",
            display: "block",
            height: rowVirtualizer.getTotalSize(),
          }}
        >
          {colHeaderRow}
          {rowVirtualizer
            .getVirtualItems()
            .map((v) => renderRow(v.index, v.start, v.size))}

          {(() => {
            const selectedRegion = visibleRegions.find(
              (r) => r.id === selectedRegionId
            );
            if (!selectedRegion) return null;
            const decorations = computeRegionDecorations(selectedRegion, sheet);
            return decorations.map((d, i) => {
              const dLeft = ROW_HEADER_WIDTH + d.bounds.startCol * cellWidth;
              const dTop = COL_HEADER_HEIGHT + d.bounds.startRow * cellHeight;
              const dWidth =
                (d.bounds.endCol - d.bounds.startCol + 1) * cellWidth;
              const dHeight =
                (d.bounds.endRow - d.bounds.startRow + 1) * cellHeight;
              // Show the decoration's label as inline text for axis-related
              // kinds — gives the user a live view of how the axis labels bind.
              const showInlineLabel =
                d.label !== undefined &&
                (d.kind === "axisNameAnchor" ||
                  d.kind === "rowAxisLabel" ||
                  d.kind === "colAxisLabel" ||
                  d.kind === "cellValue");
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
                    display: showInlineLabel ? "flex" : "block",
                    // Anchor the chip to the top-left of its band so that on large
                    // regions all overlay labels cluster near the region's corner
                    // instead of drifting apart in the middle of each band.
                    alignItems: "flex-start",
                    justifyContent: "flex-start",
                    pt: showInlineLabel ? "2px" : 0,
                    pl: showInlineLabel ? "2px" : 0,
                    overflow: "hidden",
                  }}
                >
                  {showInlineLabel && (
                    <Box
                      component="span"
                      sx={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "3px",
                        fontSize: 10,
                        fontWeight: 600,
                        lineHeight: 1,
                        px: 0.5,
                        py: 0.25,
                        borderRadius: 0.5,
                        backgroundColor: "rgba(255,255,255,0.85)",
                        color: "text.primary",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        maxWidth: "95%",
                        fontStyle:
                          d.kind === "axisNameAnchor" ? "normal" : "italic",
                      }}
                    >
                      {d.kind === "axisNameAnchor" && (
                        <AnchorIcon
                          sx={{ fontSize: 11, color: "rgba(194, 65, 12, 1)" }}
                        />
                      )}
                      {d.label}
                    </Box>
                  )}
                </Box>
              );
            });
          })()}

          {visibleRegions.map((region) => {
            let previewBounds = region.bounds;
            if (
              activeOp?.kind === "resize" &&
              activeOp.regionId === region.id
            ) {
              previewBounds = computeResizedBounds(
                activeOp.handle,
                activeOp.originalBounds,
                activeOp.current
              );
            } else if (
              activeOp?.kind === "move" &&
              activeOp.regionId === region.id
            ) {
              previewBounds = computeMovedBounds(
                activeOp.originalBounds,
                activeOp.pointerStart,
                activeOp.current,
                sheet.rowCount,
                sheet.colCount
              );
            }
            return (
              <RegionOverlayUI
                key={region.id}
                region={region}
                bounds={previewBounds}
                entityOrder={entityOrder}
                selected={region.id === selectedRegionId}
                resizable={!readOnly && Boolean(onRegionResize)}
                movable={!readOnly && Boolean(onRegionResize)}
                cellWidth={cellWidth}
                cellHeight={cellHeight}
                onBodyPointerDown={handleRegionBodyPointerDown}
                onResizeStart={handleResizeStart}
              />
            );
          })}

          {pendingBounds && (
            <Box
              sx={{
                position: "absolute",
                left: ROW_HEADER_WIDTH + pendingBounds.startCol * cellWidth,
                top: COL_HEADER_HEIGHT + pendingBounds.startRow * cellHeight,
                width:
                  (pendingBounds.endCol - pendingBounds.startCol + 1) *
                  cellWidth,
                height:
                  (pendingBounds.endRow - pendingBounds.startRow + 1) *
                  cellHeight,
                border: "2px dashed",
                borderColor: "primary.main",
                backgroundColor: "rgba(37,99,235,0.08)",
                pointerEvents: "none",
                zIndex: 4,
              }}
            />
          )}
        </div>
      </Box>
    </Box>
  );
};
