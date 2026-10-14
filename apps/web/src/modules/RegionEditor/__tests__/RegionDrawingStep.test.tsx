import "@testing-library/jest-dom";
import React from "react";
import { jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "@portalai/core/ui";

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
    headerAxes: ["row"],
    segmentsByAxis: { row: [{ kind: "field", positionCount: 3 }] },
    targetEntityDefinitionId: "ent_a",
    ...overrides,
  };
}

function baseProps(
  overrides: Partial<React.ComponentProps<typeof RegionDrawingStepUI>> = {}
) {
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

describe("RegionDrawingStepUI — sheet tab selection", () => {
  const SHEET_2 = {
    id: "s2",
    name: "Sheet 2",
    rowCount: 4,
    colCount: 3,
    cells: Array.from({ length: 4 }, () => Array.from({ length: 3 }, () => "")),
  };
  const TWO_SHEET_WORKBOOK: Workbook = { sheets: [SHEET, SHEET_2] };

  test("switching to a sheet with regions auto-selects that sheet's first region", () => {
    const onActiveSheetChange = jest.fn();
    const onSelectRegion = jest.fn();
    const s1Region = baseRegion({ id: "r1", sheetId: "s1" });
    const s2First = baseRegion({ id: "r2a", sheetId: "s2" });
    const s2Second = baseRegion({ id: "r2b", sheetId: "s2" });
    render(
      <RegionDrawingStepUI
        {...baseProps({
          workbook: TWO_SHEET_WORKBOOK,
          regions: [s1Region, s2First, s2Second],
          activeSheetId: "s1",
          selectedRegionId: "r1",
          onActiveSheetChange,
          onSelectRegion,
        })}
      />
    );
    const sheet2Tab = screen
      .getAllByRole("tab")
      .find((t) => t.textContent?.includes("Sheet 2"));
    fireEvent.click(sheet2Tab!);
    expect(onActiveSheetChange).toHaveBeenCalledWith("s2");
    expect(onSelectRegion).toHaveBeenCalledWith("r2a");
  });

  test("switching to a sheet with no regions clears the selection", () => {
    const onActiveSheetChange = jest.fn();
    const onSelectRegion = jest.fn();
    const s1Region = baseRegion({ id: "r1", sheetId: "s1" });
    render(
      <RegionDrawingStepUI
        {...baseProps({
          workbook: TWO_SHEET_WORKBOOK,
          regions: [s1Region],
          activeSheetId: "s1",
          selectedRegionId: "r1",
          onActiveSheetChange,
          onSelectRegion,
        })}
      />
    );
    const sheet2Tab = screen
      .getAllByRole("tab")
      .find((t) => t.textContent?.includes("Sheet 2"));
    fireEvent.click(sheet2Tab!);
    expect(onActiveSheetChange).toHaveBeenCalledWith("s2");
    expect(onSelectRegion).toHaveBeenCalledWith(null);
  });
});

describe("RegionDrawingStepUI — C1 claimed entity keys", () => {
  test("disables entity-picker options claimed by a sibling region", () => {
    // Two regions: r1 (currently editing, unbound) and r2 (binds ent_a).
    // The panel's entity picker should show ent_a as disabled.
    const editing = baseRegion({ id: "r1", targetEntityDefinitionId: null });
    const sibling = baseRegion({ id: "r2", targetEntityDefinitionId: "ent_a" });
    render(
      <RegionDrawingStepUI
        {...baseProps({
          regions: [editing, sibling],
          selectedRegionId: "r1",
          entityOptions: [
            { value: "ent_a", label: "Contact", source: "db" },
            { value: "ent_b", label: "Deal", source: "db" },
          ],
        })}
      />
    );
    const select = screen.getByRole("combobox", { name: /target entity/i });
    fireEvent.mouseDown(select);
    const claimed = screen.getByRole("option", { name: /Contact/i });
    expect(claimed).toHaveAttribute("aria-disabled", "true");
    const free = screen.getByRole("option", { name: /Deal/i });
    expect(free).not.toHaveAttribute("aria-disabled", "true");
  });

  test("keeps the currently-editing region's own claim selectable", () => {
    const editing = baseRegion({ id: "r1", targetEntityDefinitionId: "ent_a" });
    render(
      <RegionDrawingStepUI
        {...baseProps({
          regions: [editing],
          selectedRegionId: "r1",
          entityOptions: [{ value: "ent_a", label: "Contact", source: "db" }],
        })}
      />
    );
    const select = screen.getByRole("combobox", { name: /target entity/i });
    fireEvent.mouseDown(select);
    const own = screen.getByRole("option", { name: /Contact/i });
    expect(own).not.toHaveAttribute("aria-disabled", "true");
  });
});

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
    render(
      <RegionDrawingStepUI
        {...baseProps({ onRegionDelete, selectedRegionId: null })}
      />
    );
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
    const { rerender } = render(
      <RegionDrawingStepUI {...baseProps({ onRegionDelete })} />
    );
    rerender(
      <RegionDrawingStepUI
        {...baseProps({ onRegionDelete, selectedRegionId: null })}
      />
    );
    fireEvent.keyDown(document, { key: "Delete" });
    expect(onRegionDelete).not.toHaveBeenCalled();
  });
});

describe("RegionDrawingStepUI — keyboard Escape", () => {
  test("pressing Escape unselects the region via onSelectRegion(null)", () => {
    const onSelectRegion = jest.fn();
    const onRegionDelete = jest.fn();
    render(
      <RegionDrawingStepUI {...baseProps({ onSelectRegion, onRegionDelete })} />
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onSelectRegion).toHaveBeenCalledWith(null);
    expect(onRegionDelete).not.toHaveBeenCalled();
  });

  test("Escape does nothing when no region is selected", () => {
    const onSelectRegion = jest.fn();
    render(
      <RegionDrawingStepUI
        {...baseProps({ onSelectRegion, selectedRegionId: null })}
      />
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
      <RegionDrawingStepUI
        {...baseProps({ regions: [first, second], selectedRegionId: null })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /interpret/i }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/2 regions have validation errors/i);
    expect(alert).toHaveTextContent(/First region/);
    expect(alert).toHaveTextContent(/Second region/);
  });

  test("clicking Interpret is blocked when two regions share a target (C1 duplicate)", () => {
    const onInterpret = jest.fn();
    const first = baseRegion({
      id: "r1",
      proposedLabel: "Region 1",
      targetEntityDefinitionId: "ent_a",
    });
    const second = baseRegion({
      id: "r2",
      proposedLabel: "Region 2",
      targetEntityDefinitionId: "ent_a",
    });
    render(
      <RegionDrawingStepUI
        {...baseProps({
          onInterpret,
          regions: [first, second],
          selectedRegionId: null,
        })}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /interpret/i }));
    expect(onInterpret).not.toHaveBeenCalled();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/2 regions have validation errors/i);
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
    const chip = Array.from(alert.querySelectorAll(".MuiChip-root")).find(
      (el) => el.textContent?.includes("Second region")
    );
    expect(chip).toBeDefined();
    fireEvent.click(chip!);
    expect(onSelectRegion).toHaveBeenCalledWith("r_two");
  });
});

// #789: the step is a form around Interpret. Enter in a field Interprets
// exactly when the button could; a field that owns Enter keeps it; and an
// Escape the step handles (deselecting a region) doesn't close the dialog
// around it.
describe("RegionDrawingStepUI — keyboard (#789)", () => {
  test("Enter on the focused form Interprets", async () => {
    const user = userEvent.setup();
    const onInterpret = jest.fn();
    render(<RegionDrawingStepUI {...baseProps({ onInterpret })} />);
    screen.getByRole("button", { name: "Interpret" }).focus();
    await user.keyboard("{Enter}");
    expect(onInterpret).toHaveBeenCalledTimes(1);
  });

  test("Enter in a bounds field commits the field, not the step", async () => {
    const user = userEvent.setup();
    const onInterpret = jest.fn();
    render(<RegionDrawingStepUI {...baseProps({ onInterpret })} />);
    await user.type(screen.getByLabelText("End row"), "{Enter}");
    expect(onInterpret).not.toHaveBeenCalled();
  });

  test("Escape with a region selected deselects it and leaves the Modal open", async () => {
    const user = userEvent.setup();
    const onSelectRegion = jest.fn();
    const onClose = jest.fn();
    render(
      <Modal open onClose={onClose} title="Wizard">
        <RegionDrawingStepUI {...baseProps({ onSelectRegion })} />
      </Modal>
    );
    // Focus outside any text field, where the step's shortcuts apply.
    screen.getByRole("button", { name: "Interpret" }).focus();
    await user.keyboard("{Escape}");
    expect(onSelectRegion).toHaveBeenCalledWith(null);
    expect(onClose).not.toHaveBeenCalled();
  });
});
