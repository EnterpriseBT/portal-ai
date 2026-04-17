import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react";

import { RegionDrawingStep } from "../RegionDrawingStep.component";
import type { RegionDraft, Workbook } from "../utils/region-editor.types";

const SHEET = {
  id: "s1",
  name: "Sheet 1",
  rowCount: 4,
  colCount: 3,
  cells: Array.from({ length: 4 }, () => Array.from({ length: 3 }, () => "")),
};

const WORKBOOK: Workbook = { sheets: [SHEET] };

function baseRegion(overrides: Partial<RegionDraft> = {}): RegionDraft {
  return {
    id: "r1",
    sheetId: "s1",
    bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 2 },
    orientation: "rows-as-records",
    headerAxis: "row",
    targetEntityDefinitionId: "ent_a",
    ...overrides,
  };
}

function baseProps(overrides: Partial<React.ComponentProps<typeof RegionDrawingStep>> = {}) {
  return {
    workbook: WORKBOOK,
    regions: [baseRegion()],
    activeSheetId: "s1",
    onActiveSheetChange: jest.fn(),
    selectedRegionId: "r1",
    onSelectRegion: jest.fn(),
    onRegionDraft: jest.fn(),
    onRegionUpdate: jest.fn(),
    onRegionDelete: jest.fn(),
    entityOptions: [{ value: "ent_a", label: "Contact" }],
    onInterpret: jest.fn(),
    ...overrides,
  } as React.ComponentProps<typeof RegionDrawingStep>;
}

describe("RegionDrawingStep — keyboard delete", () => {
  test("pressing Delete removes the selected region", () => {
    const onRegionDelete = jest.fn();
    render(<RegionDrawingStep {...baseProps({ onRegionDelete })} />);
    fireEvent.keyDown(document, { key: "Delete" });
    expect(onRegionDelete).toHaveBeenCalledWith("r1");
  });

  test("pressing Backspace removes the selected region", () => {
    const onRegionDelete = jest.fn();
    render(<RegionDrawingStep {...baseProps({ onRegionDelete })} />);
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(onRegionDelete).toHaveBeenCalledWith("r1");
  });

  test("does nothing when no region is selected", () => {
    const onRegionDelete = jest.fn();
    render(<RegionDrawingStep {...baseProps({ onRegionDelete, selectedRegionId: null })} />);
    fireEvent.keyDown(document, { key: "Delete" });
    expect(onRegionDelete).not.toHaveBeenCalled();
  });

  test("does nothing when the event originates from an input", () => {
    const onRegionDelete = jest.fn();
    render(<RegionDrawingStep {...baseProps({ onRegionDelete })} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onRegionDelete).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  test("does nothing for other keys", () => {
    const onRegionDelete = jest.fn();
    render(<RegionDrawingStep {...baseProps({ onRegionDelete })} />);
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onRegionDelete).not.toHaveBeenCalled();
  });

  test("cleans up the listener when selection is cleared", () => {
    const onRegionDelete = jest.fn();
    const { rerender } = render(<RegionDrawingStep {...baseProps({ onRegionDelete })} />);
    rerender(<RegionDrawingStep {...baseProps({ onRegionDelete, selectedRegionId: null })} />);
    fireEvent.keyDown(document, { key: "Delete" });
    expect(onRegionDelete).not.toHaveBeenCalled();
  });
});

describe("RegionDrawingStep — keyboard Escape", () => {
  test("pressing Escape unselects the region via onSelectRegion(null)", () => {
    const onSelectRegion = jest.fn();
    const onRegionDelete = jest.fn();
    render(
      <RegionDrawingStep
        {...baseProps({ onSelectRegion, onRegionDelete })}
      />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSelectRegion).toHaveBeenCalledWith(null);
    expect(onRegionDelete).not.toHaveBeenCalled();
  });

  test("Escape does nothing when no region is selected", () => {
    const onSelectRegion = jest.fn();
    render(
      <RegionDrawingStep {...baseProps({ onSelectRegion, selectedRegionId: null })} />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSelectRegion).not.toHaveBeenCalled();
  });

  test("Escape is ignored while typing in an input", () => {
    const onSelectRegion = jest.fn();
    render(<RegionDrawingStep {...baseProps({ onSelectRegion })} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSelectRegion).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
