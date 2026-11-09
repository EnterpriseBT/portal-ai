import "@testing-library/jest-dom";
import { useRef, useState } from "react";
import { jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { useSheetKeyboard } from "../utils/use-sheet-keyboard.util";

const ROWS = 1000;
const COLS = 5;
const WINDOW = 20;

/**
 * A fake virtualized grid: only WINDOW rows from `first` render, and
 * `scrollToRow` moves the window on a later tick, as the virtualizer does.
 */
function Harness({ scrollSpy }: { scrollSpy: (row: number) => void }) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [first, setFirst] = useState(0);
  const { gridProps, cellProps } = useSheetKeyboard({
    rowCount: ROWS,
    colCount: COLS,
    pageRows: () => 10,
    scrollToRow: (row) => {
      scrollSpy(row);
      if (row < first || row >= first + WINDOW) {
        setTimeout(() => setFirst(Math.max(0, row - 5)), 0);
      }
    },
    gridRef,
  });
  const rows = [];
  for (let r = first; r < Math.min(ROWS, first + WINDOW); r++) {
    rows.push(
      <div key={r} role="row" aria-rowindex={r + 2}>
        {Array.from({ length: COLS }, (_, c) => (
          <div key={c} {...cellProps({ row: r, col: c })}>
            {`${r},${c}`}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div ref={gridRef} aria-label="Sheet" {...gridProps}>
      {rows}
    </div>
  );
}

function setup() {
  const scrollSpy = jest.fn<(row: number) => void>();
  render(<Harness scrollSpy={scrollSpy} />);
  const cell = (r: number, c: number) =>
    document.querySelector<HTMLElement>(`[data-cell-coord="${r}:${c}"]`);
  return { scrollSpy, cell };
}

function press(key: string, init: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(document.activeElement!, { key, ...init });
}

describe("useSheetKeyboard — movement (#795)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("the grid has one tab stop, A1, and counts its header row and column", () => {
    const { cell } = setup();
    const grid = screen.getByRole("grid", { name: "Sheet" });
    expect(grid).toHaveAttribute("aria-rowcount", String(ROWS + 1));
    expect(grid).toHaveAttribute("aria-colcount", String(COLS + 1));
    expect(cell(0, 0)).toHaveAttribute("tabindex", "0");
    expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(cell(0, 1)).toHaveAttribute("aria-colindex", "3");
  });

  test("arrow keys move the active cell and focus", () => {
    const { cell } = setup();
    cell(0, 0)!.focus();
    press("ArrowRight");
    expect(cell(0, 1)).toHaveFocus();
    press("ArrowDown");
    expect(cell(1, 1)).toHaveFocus();
    press("ArrowLeft");
    press("ArrowUp");
    expect(cell(0, 0)).toHaveFocus();
    expect(cell(0, 0)).toHaveAttribute("tabindex", "0");
    expect(cell(0, 1)).toHaveAttribute("tabindex", "-1");
  });

  test("movement stops at the edges", () => {
    const { cell } = setup();
    cell(0, 0)!.focus();
    press("ArrowUp");
    press("ArrowLeft");
    expect(cell(0, 0)).toHaveFocus();
    press("End");
    press("ArrowRight");
    expect(cell(0, COLS - 1)).toHaveFocus();
  });

  test("Home and End go to the row's first and last column", () => {
    const { cell } = setup();
    cell(2, 2)!.focus();
    press("End");
    expect(cell(2, COLS - 1)).toHaveFocus();
    press("Home");
    expect(cell(2, 0)).toHaveFocus();
  });

  test("PageDown and PageUp move by a page", () => {
    const { cell } = setup();
    cell(0, 1)!.focus();
    press("PageDown");
    expect(cell(10, 1)).toHaveFocus();
    press("PageUp");
    press("PageUp");
    expect(cell(0, 1)).toHaveFocus();
  });

  test("Ctrl+End scrolls to the last cell and focuses it once it renders", () => {
    const { cell, scrollSpy } = setup();
    cell(0, 0)!.focus();
    press("End", { ctrlKey: true });
    expect(scrollSpy).toHaveBeenLastCalledWith(ROWS - 1);
    // Not rendered yet: the window moves on the next tick.
    expect(cell(ROWS - 1, COLS - 1)).toBeNull();
    act(() => {
      jest.runAllTimers();
    });
    expect(cell(ROWS - 1, COLS - 1)).toHaveFocus();
    expect(cell(ROWS - 1, COLS - 1)).toHaveAttribute("tabindex", "0");
    press("Home", { metaKey: true });
    act(() => {
      jest.runAllTimers();
    });
    expect(cell(0, 0)).toHaveFocus();
  });

  test("focusing a cell (a click) makes it the tab stop", () => {
    const { cell } = setup();
    fireEvent.focus(cell(3, 2)!);
    expect(cell(3, 2)).toHaveAttribute("tabindex", "0");
    expect(cell(0, 0)).toHaveAttribute("tabindex", "-1");
  });

  test("keys on something that isn't a cell are left alone", () => {
    const { scrollSpy } = setup();
    const grid = screen.getByRole("grid");
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
