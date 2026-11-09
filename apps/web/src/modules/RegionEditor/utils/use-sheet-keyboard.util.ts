import React, { useCallback, useEffect, useRef, useState } from "react";

import type { CellCoord } from "./region-editor.types";

export interface SheetKeyboardOptions {
  rowCount: number;
  colCount: number;
  /** Rows per viewport, for PageUp/PageDown; read when the key is pressed. */
  pageRows: () => number;
  /** Scrolls the virtualized sheet so `row` renders. */
  scrollToRow: (row: number) => void;
  /** The grid element, where the active cell is looked up to focus it. */
  gridRef: React.RefObject<HTMLElement | null>;
}

export interface SheetGridProps {
  role: "grid";
  "aria-rowcount": number;
  "aria-colcount": number;
  onKeyDown: React.KeyboardEventHandler<HTMLElement>;
  onFocus: React.FocusEventHandler<HTMLElement>;
}

export interface SheetCellProps {
  role: "gridcell";
  "aria-colindex": number;
  tabIndex: 0 | -1;
  "data-cell-coord": string;
}

export interface SheetKeyboard {
  /** The cell holding the grid's one tab stop. */
  active: CellCoord;
  gridProps: SheetGridProps;
  cellProps: (coord: CellCoord) => SheetCellProps;
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

/**
 * The APG grid's keyboard model for the region editor's sheet (#795).
 * There's one tab stop, the active cell, and the arrow keys, Home/End,
 * Ctrl+Home/End and PageUp/PageDown move it. The sheet is virtualized, so a
 * move scrolls the row into view and the hook focuses the cell on the first
 * render that has it.
 */
export function useSheetKeyboard({
  rowCount,
  colCount,
  pageRows,
  scrollToRow,
  gridRef,
}: SheetKeyboardOptions): SheetKeyboard {
  const [active, setActive] = useState<CellCoord>({ row: 0, col: 0 });
  // Set only by a key press, so the hook never takes focus on its own.
  const pendingFocusRef = useRef<CellCoord | null>(null);

  // A sheet that shrinks (another sheet, a reload) keeps the stop on it.
  const lastRow = Math.max(0, rowCount - 1);
  const lastCol = Math.max(0, colCount - 1);
  const current: CellCoord = {
    row: clamp(active.row, lastRow),
    col: clamp(active.col, lastCol),
  };

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

  const moveTo = useCallback(
    (next: CellCoord) => {
      const target = {
        row: clamp(next.row, lastRow),
        col: clamp(next.col, lastCol),
      };
      pendingFocusRef.current = target;
      setActive(target);
      scrollToRow(target.row);
    },
    [lastRow, lastCol, scrollToRow]
  );

  const onKeyDown = useCallback<React.KeyboardEventHandler<HTMLElement>>(
    (event) => {
      const from = parseCellCoord(event.target);
      if (!from) return;
      const ctrl = event.ctrlKey || event.metaKey;
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
      moveTo(next);
    },
    [lastRow, lastCol, pageRows, moveTo]
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
      tabIndex: coord.row === current.row && coord.col === current.col ? 0 : -1,
      "data-cell-coord": cellCoordKey(coord),
    }),
    [current.row, current.col]
  );

  return {
    active: current,
    gridProps: {
      role: "grid",
      // The header row and the row-header column count too.
      "aria-rowcount": rowCount + 1,
      "aria-colcount": colCount + 1,
      onKeyDown,
      onFocus,
    },
    cellProps,
  };
}
