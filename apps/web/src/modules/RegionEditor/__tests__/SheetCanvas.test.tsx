import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

import { SheetCanvas } from "../SheetCanvas.component";
import type { RegionDraft, SheetPreview } from "../utils/region-editor.types";

function makeSheet(): SheetPreview {
  const rowCount = 6;
  const colCount = 5;
  const cells: (string | number | null)[][] = Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: colCount }, (_, c) => `${r},${c}`)
  );
  return { id: "s1", name: "Sheet 1", rowCount, colCount, cells };
}

describe("SheetCanvas", () => {
  test("renders a cell per row × col position", () => {
    render(
      <SheetCanvas
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
      <SheetCanvas
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
    expect(onDraft.mock.calls.length + onSelect.mock.calls.length).toBeGreaterThan(0);
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
      <SheetCanvas
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

  test("readOnly suppresses drag-to-draw", () => {
    const onDraft = jest.fn();
    render(
      <SheetCanvas
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
});
