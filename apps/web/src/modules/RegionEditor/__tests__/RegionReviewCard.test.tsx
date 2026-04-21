import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";

import { RegionReviewCardUI } from "../RegionReviewCard.component";
import type { RegionDraft } from "../utils/region-editor.types";

const makeRegion = (
  overrides: Partial<RegionDraft> = {}
): RegionDraft => ({
  id: "region-a",
  sheetId: "sheet_a",
  bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 2 },
  orientation: "rows-as-records",
  headerAxis: "row",
  targetEntityDefinitionId: "ent_contact",
  confidence: 0.85,
  columnBindings: [
    {
      sourceLocator: "header:Email",
      columnDefinitionId: "coldef_email",
      columnDefinitionLabel: "Email",
      confidence: 0.9,
    },
    {
      sourceLocator: "col:3",
      columnDefinitionId: "coldef_name",
      columnDefinitionLabel: "Name",
      confidence: 0.7,
      excluded: true,
    },
  ],
  warnings: [],
  ...overrides,
});

function setup(overrides: Partial<RegionDraft> = {}) {
  const onJump = jest.fn();
  const onEditBinding =
    jest.fn<(sourceLocator: string, anchorEl: HTMLElement) => void>();
  const utils = render(
    <RegionReviewCardUI
      region={makeRegion(overrides)}
      onJump={onJump}
      onEditBinding={onEditBinding}
    />
  );
  return { ...utils, onJump, onEditBinding };
}

describe("RegionReviewCardUI — excluded chip styling", () => {
  test("excluded chip carries the 'Excluded' pill", () => {
    setup();
    expect(screen.getByText(/^excluded$/i)).toBeInTheDocument();
  });

  test("excluded chip's aria-label advertises it can be re-enabled", () => {
    setup();
    // Non-excluded chip is labelled with its locator; excluded chip says "Excluded".
    const excludedChip = screen.getByRole("button", {
      name: /excluded.*col:3/i,
    });
    expect(excludedChip).toBeInTheDocument();
  });

  test("clicking a non-excluded chip fires onEditBinding with locator + anchorEl", () => {
    const { onEditBinding } = setup();
    const chip = screen.getByRole("button", {
      name: /edit binding.*header:email/i,
    });
    fireEvent.click(chip);
    expect(onEditBinding).toHaveBeenCalledWith("header:Email", chip);
  });

  test("clicking an excluded chip still fires onEditBinding (re-enable affordance)", () => {
    const { onEditBinding } = setup();
    const chip = screen.getByRole("button", { name: /excluded.*col:3/i });
    fireEvent.click(chip);
    expect(onEditBinding).toHaveBeenCalledWith("col:3", chip);
  });
});
