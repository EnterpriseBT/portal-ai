import "@testing-library/jest-dom";
import type { ComponentProps } from "react";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SelectOption, StepConfig } from "@portalai/core/ui";

import { RegionEditorUI } from "../RegionEditor.component";
import type { SearchResult } from "../../../api/types";
import type { RegionDraft, Workbook } from "../utils/region-editor.types";

const STEPS: StepConfig[] = [{ label: "Draw regions" }, { label: "Review" }];

const WORKBOOK: Workbook = {
  sheets: [
    {
      id: "s1",
      name: "Sheet 1",
      rowCount: 3,
      colCount: 2,
      cells: [
        ["Email", "Name"],
        ["a@x.io", "A"],
        ["b@x.io", "B"],
      ],
    },
  ],
};

const REGION: RegionDraft = {
  id: "r1",
  sheetId: "s1",
  bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 1 },
  headerAxes: ["row"],
  segmentsByAxis: { row: [{ kind: "field", positionCount: 2 }] },
  targetEntityDefinitionId: "ent_a",
  columnBindings: [
    {
      sourceLocator: "header:Email",
      columnDefinitionId: "coldef_email",
      columnDefinitionLabel: "Email",
      confidence: 0.9,
    },
  ],
};

function searchStub(): SearchResult<SelectOption> {
  return {
    onSearch: jest.fn(async () => [] as SelectOption[]),
    onSearchPending: false,
    onSearchError: null,
    getById: jest.fn(async () => null),
    getByIdPending: false,
    getByIdError: null,
    labelMap: {},
  };
}

function setup(overrides: Partial<ComponentProps<typeof RegionEditorUI>>) {
  const props = {
    step: 1 as const,
    stepConfigs: STEPS,
    workbook: WORKBOOK,
    regions: [REGION],
    activeSheetId: "s1",
    onActiveSheetChange: jest.fn(),
    selectedRegionId: null,
    onSelectRegion: jest.fn(),
    onRegionDraft: jest.fn(),
    onRegionUpdate: jest.fn(),
    onRegionDelete: jest.fn(),
    entityOptions: [{ value: "ent_a", label: "Contact" }],
    onInterpret: jest.fn(),
    onJumpToRegion: jest.fn(),
    onEditBinding: jest.fn(),
    onCommit: jest.fn(),
    onBack: jest.fn(),
    ...overrides,
  } as ComponentProps<typeof RegionEditorUI>;
  render(<RegionEditorUI {...props} />);
  return props;
}

describe("RegionEditorUI — the review step's binding editor (#795)", () => {
  test("with the editor's props, a chip opens the binding editor", async () => {
    const props = setup({
      onUpdateBinding: jest.fn(),
      onToggleBindingExcluded: jest.fn(),
      columnDefinitionSearch: searchStub(),
    });
    fireEvent.click(
      screen.getByRole("button", { name: /^Edit binding: header:Email/ })
    );
    expect(
      await screen.findByRole("dialog", { name: "Edit column binding" })
    ).toBeInTheDocument();
    expect(props.onEditBinding).not.toHaveBeenCalled();
  });

  test("without them, a chip falls back to onEditBinding", () => {
    const props = setup({});
    fireEvent.click(
      screen.getByRole("button", { name: /^Edit binding: header:Email/ })
    );
    expect(props.onEditBinding).toHaveBeenCalledWith("r1", "header:Email");
    expect(
      screen.queryByRole("dialog", { name: "Edit column binding" })
    ).toBeNull();
  });
});
