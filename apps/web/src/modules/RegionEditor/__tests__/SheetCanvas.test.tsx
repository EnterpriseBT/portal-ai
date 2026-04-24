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
      headerAxes: ["row"],
      segmentsByAxis: { row: [{ kind: "field", positionCount: 3 }] },
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
      headerAxes: ["column"],
      segmentsByAxis: {
        column: [
          {
            kind: "pivot",
            id: "col-pivot",
            axisName: "Category",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
      },
      cellValueField: { name: "value", nameSource: "user" },
      targetEntityDefinitionId: "ent_a",
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

  test("selected region with multiple segments renders a numbered overlay per segment", () => {
    const region: RegionDraft = {
      id: "r1",
      sheetId: "s1",
      bounds: { startRow: 1, endRow: 5, startCol: 0, endCol: 3 },
      headerAxes: ["row"],
      segmentsByAxis: {
        row: [
          { kind: "field", positionCount: 2 },
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "p1",
            axisName: "Quarter",
            axisNameSource: "user",
            positionCount: 1,
          },
        ],
      },
      targetEntityDefinitionId: "ent_a",
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
    // One overlay per row-axis segment, each with its 1-based number and
    // kind surfaced in aria-label / title for hover/ally affordance.
    expect(screen.getByTestId("segment-overlay-row-0")).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/row axis segment 1 \(Field\)/i)
    );
    expect(screen.getByTestId("segment-overlay-row-1")).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/row axis segment 2 \(Skip\)/i)
    );
    const pivotOverlay = screen.getByTestId("segment-overlay-row-2");
    expect(pivotOverlay).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/row axis segment 3 \(Pivot\) — Quarter/i)
    );
    // Pivot overlay surfaces the axis name inline.
    expect(pivotOverlay).toHaveTextContent(/Quarter/);
  });

  test("regions with segments lock the resize handles", () => {
    const region: RegionDraft = {
      id: "r1",
      sheetId: "s1",
      bounds: { startRow: 1, endRow: 3, startCol: 1, endCol: 3 },
      headerAxes: ["row"],
      segmentsByAxis: { row: [{ kind: "field", positionCount: 3 }] },
      targetEntityDefinitionId: "ent_a",
    };
    render(
      <SheetCanvasUI
        sheet={makeSheet()}
        regions={[region]}
        entityOrder={["ent_a"]}
        selectedRegionId="r1"
        onRegionSelect={jest.fn()}
        onRegionDraft={jest.fn()}
        onRegionResize={jest.fn()}
      />
    );
    // No resize handles are rendered when a region carries segments.
    expect(screen.queryByLabelText(/resize region/i)).not.toBeInTheDocument();
  });

  test("a headerless region (no segments) still renders resize handles", () => {
    const region: RegionDraft = {
      id: "r1",
      sheetId: "s1",
      bounds: { startRow: 1, endRow: 3, startCol: 1, endCol: 3 },
      targetEntityDefinitionId: "ent_a",
    };
    render(
      <SheetCanvasUI
        sheet={makeSheet()}
        regions={[region]}
        entityOrder={["ent_a"]}
        selectedRegionId="r1"
        onRegionSelect={jest.fn()}
        onRegionDraft={jest.fn()}
        onRegionResize={jest.fn()}
      />
    );
    expect(screen.getAllByLabelText(/resize region/i).length).toBeGreaterThan(0);
  });

  test("dragging a segment divider fires onSegmentResize with redistributed counts", () => {
    const region: RegionDraft = {
      id: "r1",
      sheetId: "s1",
      bounds: { startRow: 1, endRow: 3, startCol: 0, endCol: 3 },
      headerAxes: ["row"],
      segmentsByAxis: {
        row: [
          { kind: "field", positionCount: 2 },
          { kind: "skip", positionCount: 2 },
        ],
      },
      targetEntityDefinitionId: "ent_a",
    };
    const onSegmentResize = jest.fn();
    render(
      <SheetCanvasUI
        sheet={makeSheet()}
        regions={[region]}
        entityOrder={["ent_a"]}
        selectedRegionId="r1"
        onRegionSelect={jest.fn()}
        onRegionDraft={jest.fn()}
        onSegmentResize={onSegmentResize}
      />
    );
    const divider = screen.getByTestId("segment-divider-row-0");
    // clientToCell converts clientX → col via (clientX - rect.left - ROW_HEADER_WIDTH) / cellWidth
    // where rect.left is 0 in jsdom, ROW_HEADER_WIDTH=44, cellWidth=96. So col=3
    // for any clientX in [332, 428).
    fireEvent.pointerDown(divider, {
      pointerId: 1,
      clientX: 44 + 2 * 96 + 48,
      clientY: 24 + 1 * 28 + 14,
    });
    fireEvent.pointerMove(divider, {
      pointerId: 1,
      clientX: 44 + 3 * 96 + 48,
      clientY: 24 + 1 * 28 + 14,
    });
    fireEvent.pointerUp(divider, {
      pointerId: 1,
      clientX: 44 + 3 * 96 + 48,
      clientY: 24 + 1 * 28 + 14,
    });
    expect(onSegmentResize).toHaveBeenCalledWith("r1", "row", 0, 3, 1);
  });

  test("segment overlays only render for the selected region", () => {
    const region: RegionDraft = {
      id: "r1",
      sheetId: "s1",
      bounds: { startRow: 1, endRow: 3, startCol: 1, endCol: 3 },
      headerAxes: ["row"],
      segmentsByAxis: { row: [{ kind: "field", positionCount: 3 }] },
      targetEntityDefinitionId: "ent_a",
    };
    render(
      <SheetCanvasUI
        sheet={makeSheet()}
        regions={[region]}
        entityOrder={["ent_a"]}
        selectedRegionId={null}
        onRegionSelect={jest.fn()}
        onRegionDraft={jest.fn()}
      />
    );
    expect(
      screen.queryByTestId("segment-overlay-row-0")
    ).not.toBeInTheDocument();
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
