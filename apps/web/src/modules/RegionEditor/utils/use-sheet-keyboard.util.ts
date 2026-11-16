import React, { useCallback, useEffect, useRef, useState } from "react";

import { normalizeBounds } from "./a1-notation.util";
import type { CellBounds, CellCoord } from "./region-editor.types";

export interface SheetKeyboardOptions {
  rowCount: number;
  colCount: number;
  /** Rows per viewport, for PageUp/PageDown; read when the key is pressed. */
  pageRows: () => number;
  /** Scrolls the virtualized sheet so `row` renders. */
  scrollToRow: (row: number) => void;
  /** The grid element, where the active cell is looked up to focus it. */
  gridRef: React.RefObject<HTMLElement | null>;
  /** The region (if any) containing a cell. */
  regionAt?: (coord: CellCoord) => string | null;
  /** Enter on a selection of more than one cell. */
  onCreate?: (bounds: CellBounds) => void;
  /** Enter on a cell inside a region, with no selection. */
  onSelectRegion?: (regionId: string) => void;
  onSelectionChange?: (bounds: CellBounds | null) => void;
  /** Enter with nothing to create or select. */
  onHint?: () => void;
  /** Movement only: nothing is selected, created or opened. */
  readOnly?: boolean;
}

export interface SheetGridProps {
  role: "grid";
  "aria-rowcount": number;
  "aria-colcount": number;
  "aria-multiselectable": true;
  "data-has-selection"?: "";
  onKeyDown: React.KeyboardEventHandler<HTMLElement>;
  onFocus: React.FocusEventHandler<HTMLElement>;
}

export interface SheetCellProps {
  role: "gridcell";
  "aria-colindex": number;
  "aria-selected": boolean;
  tabIndex: 0 | -1;
  "data-cell-coord": string;
}

export interface SheetKeyboard {
  /** The cell holding the grid's one tab stop. */
  active: CellCoord;
  /** The keyboard's selection, the region a press of Enter would create. */
  selection: CellBounds | null;
  gridProps: SheetGridProps;
  cellProps: (coord: CellCoord) => SheetCellProps;
  /** Replaces the selection (a pointer draw clears it). */
  setSelection: (bounds: CellBounds | null) => void;
}

export const cellCoordKey = (coord: CellCoord): string =>
  `${coord.row}:${coord.col}`;

function parseCellCoord(target: EventTarget | null): CellCoord | null {
  if (!(target instanceof Element)) return null;
  const key = target.getAttribute("data-cell-coord");
  if (!key) return null;
  const [row, col] = key.split(":").map(Number);
  return { row, col };
}

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));

const isSingleCell = (b: CellBounds) =>
  b.startRow === b.endRow && b.startCol === b.endCol;

const inBounds = (c: CellCoord, b: CellBounds) =>
  c.row >= b.startRow &&
  c.row <= b.endRow &&
  c.col >= b.startCol &&
  c.col <= b.endCol;

interface Selection {
  /** The cell the selection grew from; Shift-moves extend from it. */
  anchor: CellCoord;
  bounds: CellBounds;
}

/**
 * The APG grid's keyboard model for the region editor's sheet (#795).
 *
 * There's one tab stop, the active cell; the arrow keys, Home/End,
 * Ctrl+Home/End and PageUp/PageDown move it. The sheet is virtualized, so a
 * move scrolls the row into view and the hook focuses the cell on the first
 * render that has it.
 *
 * Shift with a move extends a selection from where it began; Shift+Space
 * selects the row, Ctrl/Cmd+Space the column and Ctrl/Cmd+A the sheet.
 * Enter creates a region from a selection of more than one cell, or opens
 * the region under the active cell. Escape clears a selection; without one
 * it's left to the step (which deselects the region).
 */
export function useSheetKeyboard({
  rowCount,
  colCount,
  pageRows,
  scrollToRow,
  gridRef,
  regionAt,
  onCreate,
  onSelectRegion,
  onSelectionChange,
  onHint,
  readOnly = false,
}: SheetKeyboardOptions): SheetKeyboard {
  const [active, setActive] = useState<CellCoord>({ row: 0, col: 0 });
  const [selection, setSelectionState] = useState<Selection | null>(null);
  // Set only by a key press, so the hook never takes focus on its own.
  const pendingFocusRef = useRef<CellCoord | null>(null);

  // A sheet that shrinks (another sheet, a reload) keeps the stop on it.
  const lastRow = Math.max(0, rowCount - 1);
  const lastCol = Math.max(0, colCount - 1);
  const current: CellCoord = {
    row: clamp(active.row, lastRow),
    col: clamp(active.col, lastCol),
  };
  const bounds = selection?.bounds ?? null;

  // Runs after every render: a cell scrolled into view renders a frame or
  // more after the key press, so the focus waits until it's in the DOM.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const el = gridRef.current?.querySelector<HTMLElement>(
      `[data-cell-coord="${cellCoordKey(pending)}"]`
    );
    if (!el) return;
    pendingFocusRef.current = null;
    el.focus();
  });

  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);
  const firstSelectionRef = useRef(true);
  useEffect(() => {
    // Only changes are reported, not the empty selection a mount starts on.
    if (firstSelectionRef.current) {
      firstSelectionRef.current = false;
      return;
    }
    onSelectionChangeRef.current?.(bounds);
  }, [bounds]);

  const setSelection = useCallback((next: CellBounds | null) => {
    setSelectionState(
      next
        ? { anchor: { row: next.startRow, col: next.startCol }, bounds: next }
        : null
    );
  }, []);

  const moveTo = useCallback(
    (next: CellCoord) => {
      const target = {
        row: clamp(next.row, lastRow),
        col: clamp(next.col, lastCol),
      };
      pendingFocusRef.current = target;
      setActive(target);
      scrollToRow(target.row);
      return target;
    },
    [lastRow, lastCol, scrollToRow]
  );

  const onKeyDown = useCallback<React.KeyboardEventHandler<HTMLElement>>(
    (event) => {
      const from = parseCellCoord(event.target);
      if (!from) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const shift = event.shiftKey;

      // Selection and action keys first.
      if (event.key === " " && (shift || ctrl)) {
        event.preventDefault();
        if (readOnly) return;
        const band: CellBounds = shift
          ? {
              startRow: from.row,
              endRow: from.row,
              startCol: 0,
              endCol: lastCol,
            }
          : {
              startRow: 0,
              endRow: lastRow,
              startCol: from.col,
              endCol: from.col,
            };
        setSelectionState({ anchor: from, bounds: band });
        return;
      }
      if (ctrl && (event.key === "a" || event.key === "A")) {
        event.preventDefault();
        if (readOnly) return;
        setSelectionState({
          anchor: { row: 0, col: 0 },
          bounds: {
            startRow: 0,
            endRow: lastRow,
            startCol: 0,
            endCol: lastCol,
          },
        });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (readOnly) return;
        if (bounds && !isSingleCell(bounds)) {
          setSelectionState(null);
          onCreate?.(bounds);
          return;
        }
        const regionId = regionAt?.(from) ?? null;
        if (regionId) onSelectRegion?.(regionId);
        else onHint?.();
        return;
      }
      if (event.key === "Escape") {
        // Without a selection the step's own Escape (deselect) acts.
        if (!selection) return;
        event.preventDefault();
        setSelectionState(null);
        return;
      }

      let next: CellCoord | null = null;
      switch (event.key) {
        case "ArrowUp":
          next = { row: from.row - 1, col: from.col };
          break;
        case "ArrowDown":
          next = { row: from.row + 1, col: from.col };
          break;
        case "ArrowLeft":
          next = { row: from.row, col: from.col - 1 };
          break;
        case "ArrowRight":
          next = { row: from.row, col: from.col + 1 };
          break;
        case "Home":
          next = ctrl ? { row: 0, col: 0 } : { row: from.row, col: 0 };
          break;
        case "End":
          next = ctrl
            ? { row: lastRow, col: lastCol }
            : { row: from.row, col: lastCol };
          break;
        case "PageUp":
          next = { row: from.row - pageRows(), col: from.col };
          break;
        case "PageDown":
          next = { row: from.row + pageRows(), col: from.col };
          break;
        default:
          return;
      }
      // The grid owns these keys; the scroll container mustn't also scroll.
      event.preventDefault();
      const target = moveTo(next);
      if (shift && !readOnly) {
        // Extend from where the selection began, or start one here.
        const anchor =
          selection && inBounds(from, selection.bounds)
            ? selection.anchor
            : from;
        setSelectionState({ anchor, bounds: normalizeBounds(anchor, target) });
      } else if (selection) {
        setSelectionState(null);
      }
    },
    [
      lastRow,
      lastCol,
      pageRows,
      moveTo,
      readOnly,
      bounds,
      selection,
      regionAt,
      onCreate,
      onSelectRegion,
      onHint,
    ]
  );

  // A click (or any focus) on a cell makes it the active one.
  const onFocus = useCallback<React.FocusEventHandler<HTMLElement>>((event) => {
    const coord = parseCellCoord(event.target);
    if (!coord) return;
    setActive((prev) =>
      prev.row === coord.row && prev.col === coord.col ? prev : coord
    );
  }, []);

  const cellProps = useCallback(
    (coord: CellCoord): SheetCellProps => ({
      role: "gridcell",
      "aria-colindex": coord.col + 2,
      "aria-selected": !!bounds && inBounds(coord, bounds),
      tabIndex: coord.row === current.row && coord.col === current.col ? 0 : -1,
      "data-cell-coord": cellCoordKey(coord),
    }),
    [current.row, current.col, bounds]
  );

  return {
    active: current,
    selection: bounds,
    gridProps: {
      role: "grid",
      // The header row and the row-header column count too.
      "aria-rowcount": rowCount + 1,
      "aria-colcount": colCount + 1,
      "aria-multiselectable": true,
      ...(bounds ? { "data-has-selection": "" as const } : {}),
      onKeyDown,
      onFocus,
    },
    cellProps,
    setSelection,
  };
}
