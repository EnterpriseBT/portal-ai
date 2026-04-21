import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import type { SelectOption } from "@portalai/core/ui";

import { ReviewStepUI } from "../ReviewStep.component";
import type { ReviewStepUIProps } from "../ReviewStep.component";
import type { RegionDraft, ColumnBindingDraft } from "../utils/region-editor.types";
import type { SearchResult } from "../../../api/types";

const region: RegionDraft = {
  id: "region-a",
  sheetId: "sheet_a",
  bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 2 },
  orientation: "rows-as-records",
  headerAxis: "row",
  targetEntityDefinitionId: "ent_contact",
  targetEntityLabel: "Contacts",
  confidence: 0.85,
  columnBindings: [
    {
      sourceLocator: "header:Email",
      columnDefinitionId: "coldef_email",
      columnDefinitionLabel: "Email",
      confidence: 0.9,
    },
  ],
  warnings: [],
};

function makeSearchStub(): SearchResult<SelectOption> {
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

function setup(overrides: Partial<ReviewStepUIProps> = {}) {
  const onEditBinding = jest.fn<(regionId: string, sourceLocator: string) => void>();
  const onUpdateBinding =
    jest.fn<
      (
        regionId: string,
        sourceLocator: string,
        patch: Partial<ColumnBindingDraft>
      ) => void
    >();
  const onToggleBindingExcluded =
    jest.fn<(regionId: string, sourceLocator: string, excluded: boolean) => void>();
  const utils = render(
    <ReviewStepUI
      regions={[region]}
      overallConfidence={0.85}
      onJumpToRegion={jest.fn()}
      onEditBinding={onEditBinding}
      onUpdateBinding={onUpdateBinding}
      onToggleBindingExcluded={onToggleBindingExcluded}
      columnDefinitionSearch={makeSearchStub()}
      onCommit={jest.fn()}
      onBack={jest.fn()}
      {...overrides}
    />
  );
  return { ...utils, onEditBinding, onUpdateBinding, onToggleBindingExcluded };
}

describe("ReviewStepUI — binding editor popover", () => {
  test("clicking a chip opens the popover", () => {
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: /edit binding.*header:email/i })
    );
    const popover = document.querySelector(
      'form[aria-label="Edit column binding"]'
    );
    expect(popover).not.toBeNull();
  });

  test("Apply fires onUpdateBinding with the local draft and closes the popover", () => {
    const { onUpdateBinding } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: /edit binding.*header:email/i })
    );
    const nk = screen.getByLabelText(/normalized key/i) as HTMLInputElement;
    fireEvent.change(nk, { target: { value: "email_override" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(onUpdateBinding).toHaveBeenCalledWith(
      "region-a",
      "header:Email",
      expect.objectContaining({ normalizedKey: "email_override" })
    );
    // popover unmounts after apply
    expect(
      document.querySelector('form[aria-label="Edit column binding"]')
    ).toBeNull();
  });

  test("Omit toggle fires onToggleBindingExcluded and keeps the popover open", () => {
    const { onToggleBindingExcluded } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: /edit binding.*header:email/i })
    );
    fireEvent.click(screen.getByLabelText(/omit this column/i));
    expect(onToggleBindingExcluded).toHaveBeenCalledWith(
      "region-a",
      "header:Email",
      true
    );
    // popover stays open for follow-up edits
    expect(
      document.querySelector('form[aria-label="Edit column binding"]')
    ).not.toBeNull();
  });

  test("Cancel closes the popover without firing onUpdateBinding", () => {
    const { onUpdateBinding } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: /edit binding.*header:email/i })
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onUpdateBinding).not.toHaveBeenCalled();
    expect(
      document.querySelector('form[aria-label="Edit column binding"]')
    ).toBeNull();
  });

  test("falls back to onEditBinding when onUpdateBinding is not provided (legacy)", () => {
    const onEditBinding = jest.fn<(regionId: string, sourceLocator: string) => void>();
    render(
      <ReviewStepUI
        regions={[region]}
        overallConfidence={0.85}
        onJumpToRegion={jest.fn()}
        onEditBinding={onEditBinding}
        onCommit={jest.fn()}
        onBack={jest.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: /edit binding.*header:email/i })
    );
    expect(onEditBinding).toHaveBeenCalledWith("region-a", "header:Email");
    // no popover in legacy mode
    expect(
      document.querySelector('form[aria-label="Edit column binding"]')
    ).toBeNull();
  });
});
