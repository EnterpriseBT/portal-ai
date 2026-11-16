import React from "react";

/** What counts as a control inside a grid cell. */
const FOCUSABLE =
  "a[href], button, input, select, textarea, [tabindex], [contenteditable='true']";

/** Holds a control's own tabindex while the grid keeps it out of Tab order. */
const SAVED_TABINDEX = "data-grid-tabindex";

export interface GridNavigationOptions {
  /** Rows, counting the header row as row 0. */
  rowCount: number;
  colCount: number;
}

export interface GridCellProps {
  tabIndex: 0 | -1;
  "data-grid-cell": string;
}

export interface GridNavigation {
  /** Spread on the `<table role="grid">`. */
  gridProps: {
    ref: React.RefCallback<HTMLElement>;
    onKeyDown: React.KeyboardEventHandler<HTMLElement>;
    onFocus: React.FocusEventHandler<HTMLElement>;
    onBlur: React.FocusEventHandler<HTMLElement>;
  };
  /** Spread on each header and body cell; row 0 is the header row. */
  cellProps: (row: number, col: number) => GridCellProps;
}

const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max);

const controlsIn = (cell: Element): HTMLElement[] =>
  Array.from(cell.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.hasAttribute("disabled") &&
      el.getAttribute("type") !== "hidden" &&
      !el.closest("[aria-hidden='true']")
  );

/**
 * The WAI-ARIA APG data grid's keyboard model (#794), for a table whose cells
 * hold controls. The grid is one Tab stop, the last focused cell. In it:
 *
 * - Arrow keys move a cell at a time, stopping at the edges; Home/End go to the
 *   row's ends, and Ctrl+Home/Ctrl+End to the grid's.
 * - Enter or F2 moves focus into the cell's first control. There, keys belong
 *   to the control; Escape returns to the cell, unless the control already
 *   handled it (`defaultPrevented`, as a Select closing its menu does).
 * - Controls in other cells are out of Tab order, so Tab always leaves.
 *
 * Keys from outside the grid's DOM (a menu portaled out of a cell) are left
 * alone, though React bubbles them here.
 */
export function useGridNavigation({
  rowCount,
  colCount,
}: GridNavigationOptions): GridNavigation {
  const rootRef = React.useRef<HTMLElement | null>(null);
  const [active, setActive] = React.useState({ row: 0, col: 0 });
  const [interacting, setInteracting] = React.useState(false);

  const row = clamp(active.row, rowCount - 1);
  const col = clamp(active.col, colCount - 1);
  const activeKey = `${row}:${col}`;

  // Controls stay out of Tab order except in the cell being interacted with.
  // Runs after every render, so new rows' controls are covered too.
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll("[data-grid-cell]").forEach((cell) => {
      const open =
        interacting && cell.getAttribute("data-grid-cell") === activeKey;
      controlsIn(cell).forEach((el) => {
        if (!el.hasAttribute(SAVED_TABINDEX)) {
          el.setAttribute(SAVED_TABINDEX, el.getAttribute("tabindex") ?? "");
        }
        if (open) {
          const saved = el.getAttribute(SAVED_TABINDEX);
          if (saved) el.setAttribute("tabindex", saved);
          else el.removeAttribute("tabindex");
        } else {
          el.setAttribute("tabindex", "-1");
        }
      });
    });
  });

  const cellAt = (r: number, c: number) =>
    rootRef.current?.querySelector<HTMLElement>(
      `[data-grid-cell="${r}:${c}"]`
    ) ?? null;

  const moveTo = (r: number, c: number) => {
    const nextRow = clamp(r, rowCount - 1);
    // A row can have fewer cells than columns (an empty state's one colSpan
    // cell), so land on the nearest cell that exists rather than lose the
    // grid's tab stop.
    let nextCol = clamp(c, colCount - 1);
    while (nextCol > 0 && !cellAt(nextRow, nextCol)) nextCol -= 1;
    const cell = cellAt(nextRow, nextCol);
    if (!cell) return;
    setActive({ row: nextRow, col: nextCol });
    setInteracting(false);
    cell.focus();
  };

  const coordsOf = (cell: Element) => {
    const [r, c] = (cell.getAttribute("data-grid-cell") ?? "0:0")
      .split(":")
      .map(Number);
    return { row: r, col: c };
  };

  const onKeyDown: React.KeyboardEventHandler<HTMLElement> = (e) => {
    const root = rootRef.current;
    const target = e.target as HTMLElement;
    if (!root || !root.contains(target)) return;
    const cell = target.closest<HTMLElement>("[data-grid-cell]");
    if (!cell) return;
    const { row: r, col: c } = coordsOf(cell);

    if (target !== cell) {
      // Interaction mode: the control owns its keys, except an Escape it
      // didn't handle, which returns to the cell.
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        setInteracting(false);
        cell.focus();
      }
      return;
    }

    const ctrl = e.ctrlKey || e.metaKey;
    switch (e.key) {
      case "ArrowRight":
        moveTo(r, c + 1);
        break;
      case "ArrowLeft":
        moveTo(r, c - 1);
        break;
      case "ArrowDown":
        moveTo(r + 1, c);
        break;
      case "ArrowUp":
        moveTo(r - 1, c);
        break;
      case "Home":
        moveTo(ctrl ? 0 : r, 0);
        break;
      case "End":
        moveTo(ctrl ? rowCount - 1 : r, colCount - 1);
        break;
      case "Enter":
      case "F2": {
        const control = controlsIn(cell)[0];
        if (!control) return;
        setInteracting(true);
        control.focus();
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  };

  const onFocus: React.FocusEventHandler<HTMLElement> = (e) => {
    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>("[data-grid-cell]");
    if (!cell || !rootRef.current?.contains(cell)) return;
    setActive(coordsOf(cell));
    // Focus on a control (a click, or Enter/F2) is interaction with its cell.
    setInteracting(target !== cell);
  };

  const onBlur: React.FocusEventHandler<HTMLElement> = (e) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !rootRef.current?.contains(next)) setInteracting(false);
  };

  const ref = React.useCallback((el: HTMLElement | null) => {
    rootRef.current = el;
  }, []);

  return {
    gridProps: { ref, onKeyDown, onFocus, onBlur },
    cellProps: (r, c) => ({
      tabIndex: `${r}:${c}` === activeKey ? 0 : -1,
      "data-grid-cell": `${r}:${c}`,
    }),
  };
}
