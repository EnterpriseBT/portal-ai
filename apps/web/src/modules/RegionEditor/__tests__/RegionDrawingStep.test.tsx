import "@testing-library/jest-dom";
import React from "react";
import { jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

import { RegionDrawingStepUI } from "../RegionDrawingStep.component";
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

function baseProps(overrides: Partial<React.ComponentProps<typeof RegionDrawingStepUI>> = {}) {
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
  } as React.ComponentProps<typeof RegionDrawingStepUI>;
}

describe("RegionDrawingStepUI — keyboard delete", () => {
  test("pressing Delete removes the selected region", () => {
    const onRegionDelete = jest.fn();
    render(<RegionDrawingStepUI {...baseProps({ onRegionDelete })} />);
    fireEvent.keyDown(document, { key: "Delete" });
    expect(onRegionDelete).toHaveBeenCalledWith("r1");
  });

  test("pressing Backspace removes the selected region", () => {
    const onRegionDelete = jest.fn();
    render(<RegionDrawingStepUI {...baseProps({ onRegionDelete })} />);
    fireEvent.keyDown(document, { key: "Backspace" });
    expect(onRegionDelete).toHaveBeenCalledWith("r1");
  });

  test("does nothing when no region is selected", () => {
    const onRegionDelete = jest.fn();
    render(<RegionDrawingStepUI {...baseProps({ onRegionDelete, selectedRegionId: null })} />);
    fireEvent.keyDown(document, { key: "Delete" });
    expect(onRegionDelete).not.toHaveBeenCalled();
  });

  test("does nothing when the event originates from an input", () => {
    const onRegionDelete = jest.fn();
    render(<RegionDrawingStepUI {...baseProps({ onRegionDelete })} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onRegionDelete).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  test("does nothing for other keys", () => {
    const onRegionDelete = jest.fn();
    render(<RegionDrawingStepUI {...baseProps({ onRegionDelete })} />);
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.keyDown(document, { key: "Enter" });
    expect(onRegionDelete).not.toHaveBeenCalled();
  });

  test("cleans up the listener when selection is cleared", () => {
    const onRegionDelete = jest.fn();
    const { rerender } = render(<RegionDrawingStepUI {...baseProps({ onRegionDelete })} />);
    rerender(<RegionDrawingStepUI {...baseProps({ onRegionDelete, selectedRegionId: null })} />);
    fireEvent.keyDown(document, { key: "Delete" });
    expect(onRegionDelete).not.toHaveBeenCalled();
  });
});

describe("RegionDrawingStepUI — keyboard Escape", () => {
  test("pressing Escape unselects the region via onSelectRegion(null)", () => {
    const onSelectRegion = jest.fn();
    const onRegionDelete = jest.fn();
    render(
      <RegionDrawingStepUI
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
      <RegionDrawingStepUI {...baseProps({ onSelectRegion, selectedRegionId: null })} />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSelectRegion).not.toHaveBeenCalled();
  });

  test("Escape is ignored while typing in an input", () => {
    const onSelectRegion = jest.fn();
    render(<RegionDrawingStepUI {...baseProps({ onSelectRegion })} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSelectRegion).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});

describe("RegionDrawingStepUI — interpret validation", () => {
  test("clicking Interpret with a valid region calls onInterpret", () => {
    const onInterpret = jest.fn();
    render(<RegionDrawingStepUI {...baseProps({ onInterpret })} />);
    fireEvent.click(screen.getByRole("button", { name: /interpret/i }));
    expect(onInterpret).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("clicking Interpret with invalid regions blocks navigation and shows a summary", () => {
    const onInterpret = jest.fn();
    const onSelectRegion = jest.fn();
    const onActiveSheetChange = jest.fn();
    const invalid = baseRegion({
      id: "r_bad",
      targetEntityDefinitionId: null,
    });
    render(
      <RegionDrawingStepUI
        {...baseProps({
          onInterpret,
          onSelectRegion,
          onActiveSheetChange,
          regions: [invalid],
          selectedRegionId: null,
        })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /interpret/i }));
    expect(onInterpret).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/1 region has validation errors/i);
    expect(onSelectRegion).toHaveBeenCalledWith("r_bad");
  });

  test("clicking Interpret with two invalid regions reports the count and listed labels", () => {
    const first = baseRegion({
      id: "r_one",
      proposedLabel: "First region",
      targetEntityDefinitionId: null,
    });
    const second = baseRegion({
      id: "r_two",
      proposedLabel: "Second region",
      targetEntityDefinitionId: null,
    });
    render(
      <RegionDrawingStepUI {...baseProps({ regions: [first, second], selectedRegionId: null })} />
    );
    fireEvent.click(screen.getByRole("button", { name: /interpret/i }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/2 regions have validation errors/i);
    expect(alert).toHaveTextContent(/First region/);
    expect(alert).toHaveTextContent(/Second region/);
  });

  test("invalid-region chip jumps selection to that region", () => {
    const onSelectRegion = jest.fn();
    const first = baseRegion({
      id: "r_one",
      proposedLabel: "First region",
      targetEntityDefinitionId: null,
    });
    const second = baseRegion({
      id: "r_two",
      proposedLabel: "Second region",
      targetEntityDefinitionId: null,
    });
    const { getByRole } = render(
      <RegionDrawingStepUI
        {...baseProps({
          onSelectRegion,
          regions: [first, second],
          selectedRegionId: null,
        })}
      />
    );
    fireEvent.click(getByRole("button", { name: /interpret/i }));
    onSelectRegion.mockClear();
    const alert = getByRole("alert");
    const chip = Array.from(alert.querySelectorAll(".MuiChip-root")).find((el) =>
      el.textContent?.includes("Second region")
    );
    expect(chip).toBeDefined();
    fireEvent.click(chip!);
    expect(onSelectRegion).toHaveBeenCalledWith("r_two");
  });
});
