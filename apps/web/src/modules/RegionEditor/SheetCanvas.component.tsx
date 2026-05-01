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
  INTERSECTION_OVERLAY_BACKGROUND_IMAGE,
  INTERSECTION_OVERLAY_BORDER,
  INTERSECTION_OVERLAY_COLOR,
  SEGMENT_OVERLAY_BACKGROUND_IMAGE,
  SEGMENT_OVERLAY_BORDER,
  SEGMENT_OVERLAY_COLOR,
  computeIntersectionOverlays,
  computeRegionDecorations,
  computeSegmentOverlays,
} from "./utils/region-editor-decorations.util";
import { IntersectionEditPopoverUI } from "./IntersectionEditPopover.component";
import type {
  CellBounds,
  CellCoord,
  CellValue,
  CellValueField,
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
  /**
   * Invoked when the user drags a segment-divider and redistributes
   * positions between two adjacent segments on `axis`. `newLeft`/`newRight`
   * are the resulting positionCounts for segments at `segmentIndex` and
   * `segmentIndex + 1`; both are guaranteed ≥ 1 and sum to the original
   * combined span (bounds are never changed by this op).
   */
  onSegmentResize?: (
    regionId: string,
    axis: "row" | "column",
    segmentIndex: number,
    newLeft: number,
    newRight: number
  ) => void;
  /**
   * Apply a partial update to a region — used by the intersection editor
   * (and any future canvas-level editors) to write `intersectionCellValueFields`
   * back onto the region's draft. Wired through to the same setter
   * `RegionConfigurationPanel` consumes via its `onUpdate` prop.
   */
  onRegionUpdate?: (regionId: string, updates: Partial<RegionDraft>) => void;
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
    }
  | {
      kind: "resizeSegment";
      regionId: string;
      axis: "row" | "column";
      /** Left/top segment of the pair; right/bottom is segmentIndex + 1. */
      segmentIndex: number;
      originalLeft: number;
      originalRight: number;
      /** Combined span (originalLeft + originalRight) — invariant during drag. */
      combined: number;
      /** Start offset of the pair along the axis (cell index). */
      pairStart: number;
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
  onSegmentResize,
  onRegionUpdate,
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
  // Open-popover state for the per-intersection cell-value editor. The
  // canvas owns this directly because the overlay is canvas-rendered and
  // there is no separate "intersection strip" elsewhere in the UI.
  const [editingIntersection, setEditingIntersection] = useState<{
    regionId: string;
    intersectionId: string;
    rowPivotSegmentId: string;
    colPivotSegmentId: string;
    label: string;
    anchor: HTMLElement;
  } | null>(null);

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
      if (op.kind === "resizeSegment") {
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
        // Once a region carries segments, its bounds are locked — moving it
        // would silently invalidate positionCount totals. The click still
        // selects, but no move op starts.
        const target = regions.find((r) => r.id === regionId);
        const hasSegments =
          (target?.segmentsByAxis?.row?.length ?? 0) > 0 ||
          (target?.segmentsByAxis?.column?.length ?? 0) > 0;
        if (hasSegments) return;
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
    [
      readOnly,
      onRegionResize,
      onRegionSelect,
      capturePointer,
      clientToCell,
      regions,
    ]
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

  const handleSegmentDividerPointerDown = useCallback(
    (args: {
      regionId: string;
      axis: "row" | "column";
      segmentIndex: number;
      originalLeft: number;
      originalRight: number;
      pairStart: number;
    }) =>
      (e: React.PointerEvent) => {
        if (readOnly || !onSegmentResize) return;
        e.stopPropagation();
        e.preventDefault();
        capturePointer(e);
        // The pointer's initial cell may be at the divider boundary; seed
        // `current` to the axis-index of the existing split so no move is
        // recorded if the user releases without dragging.
        const initialCoord = clientToCell(e.clientX, e.clientY) ?? {
          row: 0,
          col: 0,
        };
        setActiveOp({
          kind: "resizeSegment",
          regionId: args.regionId,
          axis: args.axis,
          segmentIndex: args.segmentIndex,
          originalLeft: args.originalLeft,
          originalRight: args.originalRight,
          combined: args.originalLeft + args.originalRight,
          pairStart: args.pairStart,
          current: initialCoord,
        });
      },
    [readOnly, onSegmentResize, capturePointer, clientToCell]
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

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    stopAutoScroll();
    lastPointerRef.current = null;
    if (!activeOp) return;
    // Refresh the op's `current` from the final pointer event so
    // pointerUp-without-an-intervening-pointerMove (or a stale React
    // closure) still lands at the right cell.
    const releaseCoord = clientToCell(e.clientX, e.clientY);
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
    } else if (activeOp.kind === "resizeSegment") {
      const finalCoord = releaseCoord ?? activeOp.current;
      const axisIdx =
        activeOp.axis === "row" ? finalCoord.col : finalCoord.row;
      const newLeft = Math.max(
        1,
        Math.min(activeOp.combined - 1, axisIdx - activeOp.pairStart)
      );
      const newRight = activeOp.combined - newLeft;
      if (newLeft !== activeOp.originalLeft) {
        onSegmentResize?.(
          activeOp.regionId,
          activeOp.axis,
          activeOp.segmentIndex,
          newLeft,
          newRight
        );
      }
    }
    setActiveOp(null);
  }, [
    activeOp,
    clientToCell,
    onRegionDraft,
    onRegionResize,
    onRegionSelect,
    onSegmentResize,
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
  // eslint-disable-next-line react-hooks/incompatible-library -- @tanstack/react-virtual returns mutable VirtualItem refs by design; React Compiler memoization is unnecessary here, the virtualizer manages its own caching.
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
            // Project the in-progress segment-divider drag into the region so
            // overlays and decorations reflect the prospective split live.
            let previewRegion = selectedRegion;
            if (
              activeOp?.kind === "resizeSegment" &&
              activeOp.regionId === selectedRegion.id
            ) {
              const axisIdx =
                activeOp.axis === "row"
                  ? activeOp.current.col
                  : activeOp.current.row;
              const newLeft = Math.max(
                1,
                Math.min(
                  activeOp.combined - 1,
                  axisIdx - activeOp.pairStart
                )
              );
              const newRight = activeOp.combined - newLeft;
              const segs = [
                ...(selectedRegion.segmentsByAxis?.[activeOp.axis] ?? []),
              ];
              const left = segs[activeOp.segmentIndex];
              const right = segs[activeOp.segmentIndex + 1];
              if (left && right) {
                segs[activeOp.segmentIndex] = {
                  ...left,
                  positionCount: newLeft,
                };
                segs[activeOp.segmentIndex + 1] = {
                  ...right,
                  positionCount: newRight,
                };
                previewRegion = {
                  ...selectedRegion,
                  segmentsByAxis: {
                    ...(selectedRegion.segmentsByAxis ?? {}),
                    [activeOp.axis]: segs,
                  },
                };
              }
            }
            const segmentOverlays = computeSegmentOverlays(previewRegion);
            const intersectionOverlays =
              computeIntersectionOverlays(previewRegion);
            const decorations = computeRegionDecorations(previewRegion, sheet);
            const decorationEls = decorations.map((d, i) => {
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
            const segmentEls = segmentOverlays.map((o) => {
              const sLeft =
                ROW_HEADER_WIDTH + o.bounds.startCol * cellWidth;
              const sTop = COL_HEADER_HEIGHT + o.bounds.startRow * cellHeight;
              const sWidth =
                (o.bounds.endCol - o.bounds.startCol + 1) * cellWidth;
              const sHeight =
                (o.bounds.endRow - o.bounds.startRow + 1) * cellHeight;
              const badgeLabel = `${o.segmentIndex + 1}`;
              const kindLabel =
                o.kind === "field"
                  ? "Field"
                  : o.kind === "pivot"
                    ? "Pivot"
                    : "Skip";
              const titleParts = [
                `${o.axis} axis segment ${badgeLabel} (${kindLabel})`,
              ];
              if (o.label) titleParts.push(o.label);
              if (o.dynamic) titleParts.push("grows");
              // Anchor the badge per axis so the corner cell of a crosstab
              // (where row-axis segment #1 and column-axis segment #1
              // occupy the same cell) doesn't stack them on top of each
              // other. Row-axis badges ride the top-right of their cell;
              // column-axis badges ride the bottom-left. The top-left
              // quadrant stays free for the orange pivot-anchor marker.
              const isRow = o.axis === "row";
              return (
                <Box
                  key={`seg-${o.axis}-${o.segmentIndex}`}
                  data-testid={`segment-overlay-${o.axis}-${o.segmentIndex}`}
                  title={titleParts.join(" — ")}
                  aria-label={titleParts.join(" — ")}
                  sx={{
                    position: "absolute",
                    left: sLeft,
                    top: sTop,
                    width: sWidth,
                    height: sHeight,
                    backgroundColor: SEGMENT_OVERLAY_COLOR[o.kind],
                    backgroundImage: SEGMENT_OVERLAY_BACKGROUND_IMAGE[o.kind],
                    border: "1.5px solid",
                    borderColor: SEGMENT_OVERLAY_BORDER[o.kind],
                    pointerEvents: "none",
                    // Sit above the generic header decorations (z=4) so the
                    // per-segment colour wins visually, but below the region
                    // overlay/chrome (z=5+).
                    zIndex: 4.5 as unknown as number,
                    display: "flex",
                    alignItems: isRow ? "flex-start" : "flex-end",
                    justifyContent: isRow ? "flex-end" : "flex-start",
                    overflow: "hidden",
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "3px",
                      minWidth: 16,
                      height: 16,
                      // Margins keep the badge off the cell edge on the
                      // axis-appropriate side.
                      mt: isRow ? "2px" : 0,
                      mr: isRow ? "2px" : 0,
                      mb: isRow ? 0 : "2px",
                      ml: isRow ? 0 : "2px",
                      px: "4px",
                      borderRadius: "3px",
                      backgroundColor: SEGMENT_OVERLAY_BORDER[o.kind],
                      color: "#fff",
                      fontSize: 10,
                      fontWeight: 700,
                      lineHeight: 1,
                      letterSpacing: 0.2,
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      overflow: "hidden",
                      maxWidth: "95%",
                    }}
                  >
                    {badgeLabel}
                    {o.label && (
                      <Box
                        component="span"
                        sx={{
                          fontWeight: 600,
                          fontStyle: "italic",
                          pl: "2px",
                        }}
                      >
                        {o.label}
                      </Box>
                    )}
                    {o.dynamic && (
                      <Box
                        component="span"
                        sx={{ fontWeight: 700, pl: "2px" }}
                        aria-hidden
                      >
                        ∞
                      </Box>
                    )}
                  </Box>
                </Box>
              );
            });
            // Body-cell intersection blocks. Tinted rectangles colored by
            // intersection kind so the user reads the body grid at a
            // glance; only `pivot-pivot` blocks are interactive (they
            // carry an editable cell-value field name). All four kinds
            // — field-field, field-pivot, pivot-pivot, skip-mixed — are
            // emitted on 2D regions; 1D and headerless return none.
            const canEditPivotIntersections =
              !readOnly && !!onRegionUpdate;
            const intersectionEls = intersectionOverlays.map((o) => {
              const iLeft =
                ROW_HEADER_WIDTH + o.bounds.startCol * cellWidth;
              const iTop = COL_HEADER_HEIGHT + o.bounds.startRow * cellHeight;
              const iWidth =
                (o.bounds.endCol - o.bounds.startCol + 1) * cellWidth;
              const iHeight =
                (o.bounds.endRow - o.bounds.startRow + 1) * cellHeight;
              const isEditable =
                canEditPivotIntersections && o.kind === "pivot-pivot";
              const titleParts: string[] = [];
              if (o.kind === "pivot-pivot" && o.label) {
                titleParts.push(`Pivot intersection — ${o.label}`);
                if (o.cellValueName) {
                  titleParts.push(
                    o.cellValueOverridden
                      ? `Cell-value: "${o.cellValueName}" (override)`
                      : `Cell-value: "${o.cellValueName}" (inherited)`
                  );
                } else {
                  titleParts.push("Cell-value: (unset)");
                }
                if (isEditable) {
                  titleParts.push("Click to edit cell-value field name");
                }
              } else if (o.kind === "field-field") {
                titleParts.push(
                  "Field × field — body cell named by both axes (degenerate)"
                );
              } else if (o.kind === "field-pivot") {
                titleParts.push(
                  "Field × pivot — body cell carries the static-axis field value"
                );
              } else {
                titleParts.push(
                  "Skip — body cells in this block are dropped from records"
                );
              }
              return (
                <Box
                  key={`intersection-${o.id}`}
                  data-testid={`intersection-overlay-${previewRegion.id}-${o.id}`}
                  role={isEditable ? "button" : undefined}
                  tabIndex={isEditable ? 0 : undefined}
                  // Drive editing from pointer-down rather than click — the
                  // region overlay below also reacts on pointer-down, and
                  // claiming the gesture as early as possible (and on the
                  // same event family the region overlay listens to)
                  // avoids any window where the gesture could be re-routed
                  // mid-stream. preventDefault keeps the browser from
                  // promoting the gesture into a drag/text-select.
                  onPointerDown={
                    isEditable && o.label
                      ? (event) => {
                          event.stopPropagation();
                          event.preventDefault();
                          // Capture the anchor synchronously — event
                          // properties may be cleared after the handler
                          // returns and the popover needs a stable DOM ref.
                          const anchor = event.currentTarget;
                          // Selecting the region keeps the side panel in
                          // sync — clicking an intersection on a region
                          // that's currently unselected should still
                          // promote it to the active region the way a
                          // body-click would.
                          onRegionSelect(previewRegion.id);
                          setEditingIntersection({
                            regionId: previewRegion.id,
                            intersectionId: o.id,
                            rowPivotSegmentId: o.rowPivotSegmentId!,
                            colPivotSegmentId: o.colPivotSegmentId!,
                            label: o.label!,
                            anchor,
                          });
                        }
                      : undefined
                  }
                  onKeyDown={
                    isEditable && o.label
                      ? (event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          const anchor = event.currentTarget;
                          onRegionSelect(previewRegion.id);
                          setEditingIntersection({
                            regionId: previewRegion.id,
                            intersectionId: o.id,
                            rowPivotSegmentId: o.rowPivotSegmentId!,
                            colPivotSegmentId: o.colPivotSegmentId!,
                            label: o.label!,
                            anchor,
                          });
                        }
                      : undefined
                  }
                  title={titleParts.join(" — ")}
                  aria-label={titleParts.join(" — ")}
                  sx={{
                    position: "absolute",
                    left: iLeft,
                    top: iTop,
                    width: iWidth,
                    height: iHeight,
                    backgroundColor: INTERSECTION_OVERLAY_COLOR[o.kind],
                    backgroundImage:
                      INTERSECTION_OVERLAY_BACKGROUND_IMAGE[o.kind],
                    border: "1.5px dashed",
                    borderColor: INTERSECTION_OVERLAY_BORDER[o.kind],
                    pointerEvents: isEditable ? "auto" : "none",
                    cursor: isEditable ? "pointer" : "default",
                    // Editable intersection blocks must sit above the
                    // region overlay (z=5 unselected, 6 selected) so their
                    // pointer-down/click reaches the popover handler
                    // instead of triggering a region drag. Non-editable
                    // tints stay below the segment chrome (z=4.5) and
                    // above generic decorations (z=4).
                    zIndex: (isEditable ? 6.5 : 4.4) as unknown as number,
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "center",
                    overflow: "hidden",
                    "&:hover, &:focus-visible":
                      isEditable
                        ? {
                            backgroundColor: "rgba(217, 119, 6, 0.32)",
                            outline: "none",
                          }
                        : undefined,
                  }}
                >
                  {o.kind === "pivot-pivot" && o.label && (
                    <Box
                      component="span"
                      sx={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        mt: "2px",
                        px: "5px",
                        py: "1px",
                        borderRadius: "3px",
                        backgroundColor: INTERSECTION_OVERLAY_BORDER[o.kind],
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 700,
                        lineHeight: 1.1,
                        letterSpacing: 0.2,
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        maxWidth: "95%",
                      }}
                    >
                      <Box component="span">{o.label}</Box>
                      {o.cellValueName && (
                        <Box
                          component="span"
                          sx={{
                            fontWeight: 600,
                            fontStyle: o.cellValueOverridden
                              ? "normal"
                              : "italic",
                            opacity: o.cellValueOverridden ? 1 : 0.85,
                          }}
                        >
                          : {o.cellValueName}
                        </Box>
                      )}
                    </Box>
                  )}
                </Box>
              );
            });
            // Drag handles between adjacent segments, one per axis. They let
            // the user rebalance positionCount within the region without
            // resizing the region itself.
            const dividerEls: React.ReactElement[] = [];
            const addAxisDividers = (axis: "row" | "column") => {
              if (!onSegmentResize) return;
              const segs = previewRegion.segmentsByAxis?.[axis] ?? [];
              if (segs.length < 2) return;
              const baseOffsetAxis =
                axis === "row"
                  ? previewRegion.bounds.startCol
                  : previewRegion.bounds.startRow;
              let offset = 0;
              for (let i = 0; i < segs.length - 1; i++) {
                offset += segs[i].positionCount;
                const dividerAxisIdx = baseOffsetAxis + offset;
                const handleSize = 8;
                let handleLeft: number;
                let handleTop: number;
                let handleWidth: number;
                let handleHeight: number;
                if (axis === "row") {
                  handleLeft =
                    ROW_HEADER_WIDTH + dividerAxisIdx * cellWidth - handleSize / 2;
                  handleTop =
                    COL_HEADER_HEIGHT +
                    previewRegion.bounds.startRow * cellHeight;
                  handleWidth = handleSize;
                  handleHeight = cellHeight;
                } else {
                  handleLeft =
                    ROW_HEADER_WIDTH +
                    previewRegion.bounds.startCol * cellWidth;
                  handleTop =
                    COL_HEADER_HEIGHT +
                    dividerAxisIdx * cellHeight -
                    handleSize / 2;
                  handleWidth = cellWidth;
                  handleHeight = handleSize;
                }
                dividerEls.push(
                  <Box
                    key={`divider-${axis}-${i}`}
                    data-testid={`segment-divider-${axis}-${i}`}
                    aria-label={`Resize ${axis} segments ${i + 1} and ${i + 2}`}
                    onPointerDown={handleSegmentDividerPointerDown({
                      regionId: previewRegion.id,
                      axis,
                      segmentIndex: i,
                      originalLeft: segs[i].positionCount,
                      originalRight: segs[i + 1].positionCount,
                      pairStart:
                        baseOffsetAxis + offset - segs[i].positionCount,
                    })}
                    sx={{
                      position: "absolute",
                      left: handleLeft,
                      top: handleTop,
                      width: handleWidth,
                      height: handleHeight,
                      cursor: axis === "row" ? "ew-resize" : "ns-resize",
                      // Must sit above the selected-region overlay (z=6) so
                      // hover cursor and pointerdown land on the divider
                      // instead of the overlay that covers the header band.
                      zIndex: 8,
                      touchAction: "none",
                      // A subtle always-on tint hints at the drag affordance;
                      // it intensifies on hover/focus for clearer feedback.
                      backgroundColor: "rgba(37, 99, 235, 0.28)",
                      "&:hover, &:focus-visible": {
                        backgroundColor: "rgba(37, 99, 235, 0.75)",
                      },
                    }}
                  />
                );
              }
            };
            addAxisDividers("row");
            addAxisDividers("column");
            return (
              <>
                {decorationEls}
                {intersectionEls}
                {segmentEls}
                {dividerEls}
              </>
            );
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
            // Once a region has any segment on any axis, its bounds are
            // locked: a bounds change would silently invalidate the
            // positionCount math the user tuned. Segment-divider drag is the
            // intended way to rebalance positions within the locked frame.
            const hasSegments =
              (region.segmentsByAxis?.row?.length ?? 0) > 0 ||
              (region.segmentsByAxis?.column?.length ?? 0) > 0;
            return (
              <RegionOverlayUI
                key={region.id}
                region={region}
                bounds={previewBounds}
                entityOrder={entityOrder}
                selected={region.id === selectedRegionId}
                resizable={
                  !readOnly && !hasSegments && Boolean(onRegionResize)
                }
                movable={!readOnly && !hasSegments && Boolean(onRegionResize)}
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
      {editingIntersection &&
        (() => {
          const region = regions.find(
            (r) => r.id === editingIntersection.regionId
          );
          if (!region) return null;
          const override =
            region.intersectionCellValueFields?.[
              editingIntersection.intersectionId
            ];
          const overrideName = override?.name?.trim() ?? "";
          const overridden = overrideName !== "";
          const fallbackName = region.cellValueField?.name?.trim() ?? "";
          const close = () => setEditingIntersection(null);
          const writeOverride = (next: Record<string, CellValueField> | undefined) => {
            onRegionUpdate?.(region.id, {
              intersectionCellValueFields: next,
            });
          };
          const handleChange = (value: string) => {
            const trimmed = value.trim();
            const map = { ...(region.intersectionCellValueFields ?? {}) };
            if (trimmed === "") {
              delete map[editingIntersection.intersectionId];
            } else {
              const prior = map[editingIntersection.intersectionId];
              map[editingIntersection.intersectionId] = {
                ...(prior ?? {}),
                name: value,
                nameSource: "user",
              };
            }
            writeOverride(Object.keys(map).length === 0 ? undefined : map);
          };
          const handleClear = () => {
            const map = { ...(region.intersectionCellValueFields ?? {}) };
            delete map[editingIntersection.intersectionId];
            writeOverride(Object.keys(map).length === 0 ? undefined : map);
          };
          return (
            <IntersectionEditPopoverUI
              open={true}
              anchorEl={editingIntersection.anchor}
              label={editingIntersection.label}
              value={overrideName}
              fallbackName={fallbackName || undefined}
              overridden={overridden}
              onChange={handleChange}
              onClear={handleClear}
              onClose={close}
            />
          );
        })()}
    </Box>
  );
};
