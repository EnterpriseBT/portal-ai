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

  // ──────────────────────────────────────────────────────────────────────────
  // Touch (long-press) gesture model.
  // Mouse and pen pointerdown act synchronously as before; only `pointerType:
  // "touch"` events go through the long-press primer with a 350ms threshold
  // and a 10px movement-cancel.
  // ──────────────────────────────────────────────────────────────────────────

  describe("desktop pointer paths (mouse + pen) act synchronously", () => {
    test("mouse pointerdown immediately starts a draw", () => {
      const onDraft = jest.fn();
      render(
        <SheetCanvasUI
          sheet={makeSheet()}
          regions={[]}
          entityOrder={[]}
          selectedRegionId={null}
          onRegionSelect={jest.fn()}
          onRegionDraft={onDraft}
        />
      );
      const cell = screen.getByTestId("cell-1-1");
      fireEvent.pointerDown(cell, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 188,
        clientY: 66,
      });
      fireEvent.pointerMove(cell, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 380,
        clientY: 122,
      });
      fireEvent.pointerUp(cell, {
        pointerId: 1,
        pointerType: "mouse",
        clientX: 380,
        clientY: 122,
      });
      expect(onDraft).toHaveBeenCalledWith({
        startRow: 1,
        endRow: 3,
        startCol: 1,
        endCol: 3,
      });
    });

    test("pen pointerdown immediately starts a draw", () => {
      const onDraft = jest.fn();
      render(
        <SheetCanvasUI
          sheet={makeSheet()}
          regions={[]}
          entityOrder={[]}
          selectedRegionId={null}
          onRegionSelect={jest.fn()}
          onRegionDraft={onDraft}
        />
      );
      const cell = screen.getByTestId("cell-1-1");
      fireEvent.pointerDown(cell, {
        pointerId: 1,
        pointerType: "pen",
        clientX: 188,
        clientY: 66,
      });
      fireEvent.pointerMove(cell, {
        pointerId: 1,
        pointerType: "pen",
        clientX: 380,
        clientY: 122,
      });
      fireEvent.pointerUp(cell, {
        pointerId: 1,
        pointerType: "pen",
        clientX: 380,
        clientY: 122,
      });
      expect(onDraft).toHaveBeenCalledWith({
        startRow: 1,
        endRow: 3,
        startCol: 1,
        endCol: 3,
      });
    });
  });

  // Body-cell drafting on the bare grid still goes through the long-press
  // primer because the scroll container is `pan-x pan-y` — it has to share
  // the gesture surface with native pan. Dedicated affordances (headers,
  // region body, resize handles, segment dividers, editable intersections)
  // each set local `touchAction: "none"` and engage immediately on touch.
  describe("touch pointer path", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      act(() => {
        jest.runOnlyPendingTimers();
      });
      jest.useRealTimers();
    });

    test("touch tap on empty cell does not draft a region", () => {
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
      const cell = screen.getByTestId("cell-1-1");
      fireEvent.pointerDown(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 188,
        clientY: 66,
      });
      fireEvent.pointerUp(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 188,
        clientY: 66,
      });
      expect(onDraft).not.toHaveBeenCalled();
      // Tap outside any region clears selection (matches today's "click outside" semantics).
      expect(onSelect).toHaveBeenCalledWith(null);
    });

    test("touch tap inside an existing region selects it without drafting", () => {
      const onDraft = jest.fn();
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
          onRegionDraft={onDraft}
        />
      );
      const overlay = screen.getByLabelText(/Region/i);
      fireEvent.pointerDown(overlay, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 200,
        clientY: 60,
      });
      fireEvent.pointerUp(overlay, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 200,
        clientY: 60,
      });
      expect(onSelect).toHaveBeenCalledWith("r1");
      expect(onDraft).not.toHaveBeenCalled();
    });

    test("touch drag (pointermove > 10px) before timer fires does NOT draft", () => {
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
      const cell = screen.getByTestId("cell-1-1");
      fireEvent.pointerDown(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 188,
        clientY: 66,
      });
      fireEvent.pointerMove(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 230, // 42px right — exceeds 10px tolerance
        clientY: 66,
      });
      act(() => {
        jest.advanceTimersByTime(500);
      });
      fireEvent.pointerUp(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 230,
        clientY: 66,
      });
      expect(onDraft).not.toHaveBeenCalled();
      // No tap-on-release either, because the pointer moved past the tap threshold.
      expect(onSelect).not.toHaveBeenCalled();
    });

    test("touch hold ≥ 350ms then drag draws a region", () => {
      const onDraft = jest.fn();
      render(
        <SheetCanvasUI
          sheet={makeSheet()}
          regions={[]}
          entityOrder={[]}
          selectedRegionId={null}
          onRegionSelect={jest.fn()}
          onRegionDraft={onDraft}
        />
      );
      const cell = screen.getByTestId("cell-1-1");
      fireEvent.pointerDown(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 188,
        clientY: 66,
      });
      act(() => {
        jest.advanceTimersByTime(350);
      });
      fireEvent.pointerMove(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 380,
        clientY: 122,
      });
      fireEvent.pointerUp(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 380,
        clientY: 122,
      });
      expect(onDraft).toHaveBeenCalledWith({
        startRow: 1,
        endRow: 3,
        startCol: 1,
        endCol: 3,
      });
    });

    test("touch hold ≥ 350ms with no drag drafts the single cell", () => {
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
      const cell = screen.getByTestId("cell-1-1");
      fireEvent.pointerDown(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 188,
        clientY: 66,
      });
      // Cross the long-press threshold so the timer fires and the draw op
      // is engaged on a single cell.
      act(() => {
        jest.advanceTimersByTime(350);
      });
      // Lift without ever moving — the user's hold should persist as a
      // single-cell draft, not collapse into a select.
      fireEvent.pointerUp(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 188,
        clientY: 66,
      });
      expect(onDraft).toHaveBeenCalledWith({
        startRow: 1,
        endRow: 1,
        startCol: 1,
        endCol: 1,
      });
      expect(onSelect).not.toHaveBeenCalled();
    });

    test("touch hold < 350ms then drag does NOT draw", () => {
      const onDraft = jest.fn();
      render(
        <SheetCanvasUI
          sheet={makeSheet()}
          regions={[]}
          entityOrder={[]}
          selectedRegionId={null}
          onRegionSelect={jest.fn()}
          onRegionDraft={onDraft}
        />
      );
      const cell = screen.getByTestId("cell-1-1");
      fireEvent.pointerDown(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 188,
        clientY: 66,
      });
      act(() => {
        jest.advanceTimersByTime(200);
      });
      fireEvent.pointerMove(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 380,
        clientY: 122,
      });
      fireEvent.pointerUp(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 380,
        clientY: 122,
      });
      expect(onDraft).not.toHaveBeenCalled();
    });

    test("pointercancel during prime aborts the long-press cleanly", () => {
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
      const cell = screen.getByTestId("cell-1-1");
      fireEvent.pointerDown(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 188,
        clientY: 66,
      });
      fireEvent.pointerCancel(cell, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 188,
        clientY: 66,
      });
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(onDraft).not.toHaveBeenCalled();
      expect(onSelect).not.toHaveBeenCalled();
    });

    test("touch on a column header drafts a column band immediately", () => {
      const onDraft = jest.fn();
      render(
        <SheetCanvasUI
          sheet={makeSheet()}
          regions={[]}
          entityOrder={[]}
          selectedRegionId={null}
          onRegionSelect={jest.fn()}
          onRegionDraft={onDraft}
        />
      );
      // Column header B (data-col-header="1")
      const colHdr = document.querySelector('[data-col-header="1"]') as HTMLElement;
      expect(colHdr).toBeTruthy();
      fireEvent.pointerDown(colHdr, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 188,
        clientY: 12,
      });
      fireEvent.pointerUp(colHdr, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 188,
        clientY: 12,
      });
      expect(onDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          startRow: 0,
          endRow: 5,
          startCol: 1,
          endCol: 1,
        })
      );
    });

    test("touch on a row header drafts a row band immediately", () => {
      const onDraft = jest.fn();
      render(
        <SheetCanvasUI
          sheet={makeSheet()}
          regions={[]}
          entityOrder={[]}
          selectedRegionId={null}
          onRegionSelect={jest.fn()}
          onRegionDraft={onDraft}
        />
      );
      const rowHdr = document.querySelector('[data-row-header="2"]') as HTMLElement;
      expect(rowHdr).toBeTruthy();
      fireEvent.pointerDown(rowHdr, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 22,
        clientY: 24 + 2 * 28 + 14,
      });
      fireEvent.pointerUp(rowHdr, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 22,
        clientY: 24 + 2 * 28 + 14,
      });
      expect(onDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          startRow: 2,
          endRow: 2,
          startCol: 0,
          endCol: 4,
        })
      );
    });

    test("touch on the corner header drafts whole-sheet immediately", () => {
      const onDraft = jest.fn();
      render(
        <SheetCanvasUI
          sheet={makeSheet()}
          regions={[]}
          entityOrder={[]}
          selectedRegionId={null}
          onRegionSelect={jest.fn()}
          onRegionDraft={onDraft}
        />
      );
      const corner = document.querySelector('[data-corner-header]') as HTMLElement;
      expect(corner).toBeTruthy();
      fireEvent.pointerDown(corner, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 22,
        clientY: 12,
      });
      fireEvent.pointerUp(corner, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 22,
        clientY: 12,
      });
      expect(onDraft).toHaveBeenCalledWith({
        startRow: 0,
        endRow: 5,
        startCol: 0,
        endCol: 4,
      });
    });

    test("touch tap on a region body selects it without committing a move", () => {
      const onSelect = jest.fn();
      const onResize = jest.fn();
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
          selectedRegionId={null}
          onRegionSelect={onSelect}
          onRegionDraft={jest.fn()}
          onRegionResize={onResize}
        />
      );
      const overlay = screen.getByLabelText(/Region/i);
      // Region body has local touchAction: "none" — pointerdown selects
      // synchronously and primes a move op that commits only if the
      // pointer moves before release.
      fireEvent.pointerDown(overlay, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 200,
        clientY: 60,
      });
      expect(onSelect).toHaveBeenCalledWith("r1");
      fireEvent.pointerUp(overlay, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 200,
        clientY: 60,
      });
      expect(onResize).not.toHaveBeenCalled();
    });

    test("touch drag on a resize handle commits the new bounds via onRegionResize", () => {
      const onResize = jest.fn();
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
          onRegionResize={onResize}
        />
      );
      const seHandle = screen.getByLabelText("Resize region se");
      // Resize handles set local touchAction: "none" and engage immediately.
      fireEvent.pointerDown(seHandle, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 44 + 3 * 96 + 48,
        clientY: 24 + 3 * 28 + 14,
      });
      fireEvent.pointerMove(seHandle, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 44 + 4 * 96 + 48,
        clientY: 24 + 4 * 28 + 14,
      });
      fireEvent.pointerUp(seHandle, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 44 + 4 * 96 + 48,
        clientY: 24 + 4 * 28 + 14,
      });
      expect(onResize).toHaveBeenCalledWith("r1", {
        startRow: 1,
        endRow: 4,
        startCol: 1,
        endCol: 4,
      });
    });

    test("touch drag on a segment divider fires onSegmentResize", () => {
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
      fireEvent.pointerDown(divider, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 44 + 2 * 96 + 48,
        clientY: 24 + 1 * 28 + 14,
      });
      fireEvent.pointerMove(divider, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 44 + 3 * 96 + 48,
        clientY: 24 + 1 * 28 + 14,
      });
      fireEvent.pointerUp(divider, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 44 + 3 * 96 + 48,
        clientY: 24 + 1 * 28 + 14,
      });
      expect(onSegmentResize).toHaveBeenCalledWith("r1", "row", 0, 3, 1);
    });

    test("touch on a pivot×pivot intersection opens the editor popover immediately", () => {
      const region: RegionDraft = {
        id: "r1",
        sheetId: "s1",
        bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 4 },
        headerAxes: ["row", "column"],
        segmentsByAxis: {
          row: [
            { kind: "skip", positionCount: 1 },
            {
              kind: "pivot",
              id: "rp1",
              axisName: "Region",
              axisNameSource: "user",
              positionCount: 4,
            },
          ],
          column: [
            { kind: "skip", positionCount: 1 },
            {
              kind: "pivot",
              id: "cp1",
              axisName: "Quarter",
              axisNameSource: "user",
              positionCount: 4,
            },
          ],
        },
        cellValueField: { name: "Revenue", nameSource: "user" },
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
          onRegionUpdate={jest.fn()}
        />
      );
      const overlay = screen.getByTestId("intersection-overlay-r1-rp1__cp1");
      // Editable intersections set local touchAction: "none" and engage on
      // pointerdown for every pointer type — touch matches mouse here.
      fireEvent.pointerDown(overlay, {
        pointerId: 1,
        pointerType: "touch",
        clientX: 200,
        clientY: 100,
      });
      expect(
        screen.getByRole("textbox", {
          name: /cell-value field name for this intersection/i,
        })
      ).toBeInTheDocument();
    });
  });

  test("clicking a pivot×pivot intersection overlay opens the cell-value editor popover", () => {
    const region: RegionDraft = {
      id: "r1",
      sheetId: "s1",
      bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 4 },
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "rp1",
            axisName: "Region",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
        column: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "cp1",
            axisName: "Quarter",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
      },
      cellValueField: { name: "Revenue", nameSource: "user" },
      targetEntityDefinitionId: "ent_a",
    };
    const onRegionUpdate = jest.fn();
    render(
      <SheetCanvasUI
        sheet={makeSheet()}
        regions={[region]}
        entityOrder={["ent_a"]}
        selectedRegionId="r1"
        onRegionSelect={jest.fn()}
        onRegionDraft={jest.fn()}
        onRegionUpdate={onRegionUpdate}
      />
    );
    const overlay = screen.getByTestId("intersection-overlay-r1-rp1__cp1");
    expect(overlay).toBeInTheDocument();
    // Editing fires on pointer-down (same event family the region overlay
    // body listens to) so the gesture is claimed before any region-drag
    // can start.
    fireEvent.pointerDown(overlay, {
      pointerId: 1,
      clientX: 200,
      clientY: 100,
    });
    expect(
      screen.getByRole("textbox", {
        name: /cell-value field name for this intersection/i,
      })
    ).toBeInTheDocument();
  });
});
