import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { SheetCanvasUI } from "../SheetCanvas.component";
import type { LoadSliceFn } from "../SheetCanvas.component";
import type {
  CellValue,
  RegionDraft,
  SheetPreview,
} from "../utils/region-editor.types";

function makeSheet(): SheetPreview {
  const rowCount = 6;
  const colCount = 5;
  const cells: (string | number | null)[][] = Array.from(
    { length: rowCount },
    (_, r) => Array.from({ length: colCount }, (_, c) => `${r},${c}`)
  );
  return { id: "s1", name: "Sheet 1", rowCount, colCount, cells };
}

describe("SheetCanvasUI", () => {
  test("renders a cell per row × col position", () => {
    render(
      <SheetCanvasUI
        sheet={makeSheet()}
        regions={[]}
        entityOrder={[]}
        selectedRegionId={null}
        onRegionSelect={jest.fn()}
        onRegionDraft={jest.fn()}
      />
    );
    expect(screen.getByTestId("cell-0-0")).toBeInTheDocument();
    expect(screen.getByTestId("cell-5-4")).toBeInTheDocument();
  });

  test("a drag sequence emits onRegionDraft or onRegionSelect (not silent)", () => {
    const onDraft = jest.fn();
    const onSelect = jest.fn();
    render(
      <SheetCanvasUI
        sheet={makeSheet()}
        regions={[]}
        entityOrder={[]}
        selectedRegionId={null}
        onRegionSelect={onSelect}
        onRegionDraft={onDraft}
      />
    );
    const start = screen.getByTestId("cell-1-1");
    fireEvent.pointerDown(start, { pointerId: 1, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(start, { pointerId: 1, clientX: 300, clientY: 140 });
    fireEvent.pointerUp(start, { pointerId: 1 });
    // Either a region-draft or a cell-click selection fires — never silent.
    expect(
      onDraft.mock.calls.length + onSelect.mock.calls.length
    ).toBeGreaterThan(0);
  });

  test("clicking inside an existing region selects it", () => {
    const onSelect = jest.fn();
    const region: RegionDraft = {
      id: "r1",
      sheetId: "s1",
      bounds: { startRow: 1, endRow: 3, startCol: 1, endCol: 3 },
      orientation: "rows-as-records",
      headerAxis: "row",
      targetEntityDefinitionId: "ent_a",
    };
    render(
      <SheetCanvasUI
        sheet={makeSheet()}
        regions={[region]}
        entityOrder={["ent_a"]}
        selectedRegionId={null}
        onRegionSelect={onSelect}
        onRegionDraft={jest.fn()}
      />
    );
    const overlay = screen.getByLabelText(/Region/i);
    fireEvent.pointerDown(overlay, { pointerId: 1, clientX: 200, clientY: 60 });
    expect(onSelect).toHaveBeenCalledWith("r1");
  });

  test("selected pivoted region renders the anchor icon on the axis-name anchor decoration", () => {
    const region: RegionDraft = {
      id: "r1",
      sheetId: "s1",
      bounds: { startRow: 1, endRow: 4, startCol: 1, endCol: 3 },
      orientation: "rows-as-records",
      headerAxis: "column",
      targetEntityDefinitionId: "ent_a",
      recordsAxisName: { name: "Category", source: "user" },
    };
    render(
      <SheetCanvasUI
        sheet={makeSheet()}
        regions={[region]}
        entityOrder={["ent_a"]}
        selectedRegionId="r1"
        onRegionSelect={jest.fn()}
        onRegionDraft={jest.fn()}
      />
    );
    expect(screen.getByTestId("AnchorIcon")).toBeInTheDocument();
    expect(screen.queryByText(/↖/)).not.toBeInTheDocument();
  });

  test("readOnly suppresses drag-to-draw", () => {
    const onDraft = jest.fn();
    render(
      <SheetCanvasUI
        sheet={makeSheet()}
        regions={[]}
        entityOrder={[]}
        selectedRegionId={null}
        onRegionSelect={jest.fn()}
        onRegionDraft={onDraft}
        readOnly
      />
    );
    const cell = screen.getByTestId("cell-0-0");
    fireEvent.pointerDown(cell, { pointerId: 1, clientX: 50, clientY: 30 });
    fireEvent.pointerMove(cell, { pointerId: 1, clientX: 200, clientY: 120 });
    fireEvent.pointerUp(cell, { pointerId: 1 });
    expect(onDraft).not.toHaveBeenCalled();
  });

  test("virtualization renders a bounded cell count for huge sheets", () => {
    const rowCount = 10000;
    const colCount = 20;
    const sheet: SheetPreview = {
      id: "huge",
      name: "Huge",
      rowCount,
      colCount,
      cells: [],
    };
    render(
      <SheetCanvasUI
        sheet={sheet}
        regions={[]}
        entityOrder={[]}
        selectedRegionId={null}
        onRegionSelect={jest.fn()}
        onRegionDraft={jest.fn()}
      />
    );
    const cells = screen.queryAllByTestId(/^cell-\d+-\d+$/);
    // Far below rowCount × colCount (= 200,000). Viewport at 420px / 28px ≈
    // 15 visible rows + overscan 8 → at most ~35 rows × 20 cols = 700 cells.
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThan(2000);
  });

  test("loadSlice is invoked for unloaded visible rows and cells fill in", async () => {
    const loadSlice = jest.fn<LoadSliceFn>(
      async ({ rowStart, rowEnd, colEnd }) => {
        const width = colEnd + 1;
        const out: CellValue[][] = [];
        for (let r = rowStart; r <= rowEnd; r++) {
          const row: CellValue[] = [];
          for (let c = 0; c < width; c++) row.push(`slice-${r}-${c}`);
          out.push(row);
        }
        return out;
      }
    );

    render(
      <SheetCanvasUI
        sheet={{
          id: "sliced",
          name: "Sliced",
          rowCount: 200,
          colCount: 4,
          cells: [],
        }}
        regions={[]}
        entityOrder={[]}
        selectedRegionId={null}
        onRegionSelect={jest.fn()}
        onRegionDraft={jest.fn()}
        loadSlice={loadSlice}
      />
    );

    await waitFor(() => expect(loadSlice).toHaveBeenCalled());
    const firstCall = loadSlice.mock.calls[0][0];
    expect(firstCall.sheetId).toBe("sliced");
    expect(firstCall.rowStart).toBe(0);
    expect(firstCall.rowEnd).toBeGreaterThan(0);
    expect(firstCall.colStart).toBe(0);
    expect(firstCall.colEnd).toBe(3);

    await waitFor(() =>
      expect(screen.getByTestId("cell-0-0")).toHaveTextContent("slice-0-0")
    );
  });

  test("unloaded rows render a placeholder until loadSlice resolves", () => {
    // loadSlice that never resolves — keeps rows in the "pending" state.
    const pendingLoadSlice = jest.fn<LoadSliceFn>(
      () => new Promise<CellValue[][]>(() => {})
    );
    render(
      <SheetCanvasUI
        sheet={{
          id: "sliced",
          name: "Sliced",
          rowCount: 200,
          colCount: 4,
          cells: [],
        }}
        regions={[]}
        entityOrder={[]}
        selectedRegionId={null}
        onRegionSelect={jest.fn()}
        onRegionDraft={jest.fn()}
        loadSlice={pendingLoadSlice}
      />
    );
    const cell = screen.getByTestId("cell-0-0");
    expect(cell).toHaveTextContent("…");
    expect(cell).toHaveAttribute("aria-busy", "true");
  });

  test("does not refetch the same rectangle on rerender", async () => {
    let resolveFetch: (v: CellValue[][]) => void = () => {};
    const loadSlice = jest.fn<LoadSliceFn>(
      () =>
        new Promise<CellValue[][]>((resolve) => {
          resolveFetch = resolve;
        })
    );
    const props = {
      sheet: {
        id: "sliced",
        name: "Sliced",
        rowCount: 50,
        colCount: 3,
        cells: [],
      } as SheetPreview,
      regions: [] as RegionDraft[],
      entityOrder: [] as string[],
      selectedRegionId: null,
      onRegionSelect: jest.fn(),
      onRegionDraft: jest.fn(),
      loadSlice,
    };
    const { rerender } = render(<SheetCanvasUI {...props} />);
    await waitFor(() => expect(loadSlice).toHaveBeenCalledTimes(1));

    const fetched: CellValue[][] = Array.from({ length: 50 }, (_, r) =>
      Array.from({ length: 3 }, (_, c) => `v-${r}-${c}`)
    );
    await act(async () => {
      resolveFetch(fetched);
    });

    // Trigger a rerender that should not re-fetch — the rows are cached now.
    rerender(<SheetCanvasUI {...props} readOnly />);
    await waitFor(() =>
      expect(screen.getByTestId("cell-0-0")).toHaveTextContent("v-0-0")
    );
    expect(loadSlice).toHaveBeenCalledTimes(1);
  });
});
