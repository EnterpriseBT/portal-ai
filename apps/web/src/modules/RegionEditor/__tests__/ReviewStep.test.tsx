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

  test("opening the popover pre-fills normalizedKey with the derived source name", () => {
    setup();
    fireEvent.click(
      screen.getByRole("button", { name: /edit binding.*header:email/i })
    );
    const nk = screen.getByLabelText(/normalized key/i) as HTMLInputElement;
    expect(nk.value).toBe("email");
  });

  test("Apply strips normalizedKey from the patch when it equals the derived default", () => {
    const { onUpdateBinding } = setup();
    fireEvent.click(
      screen.getByRole("button", { name: /edit binding.*header:email/i })
    );
    // Toggle Required so the patch isn't empty — we want to verify that
    // normalizedKey is *not* included in the outbound patch when it matches
    // the derived default (the field value stayed pre-filled).
    fireEvent.click(screen.getByLabelText(/^required$/i));
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(onUpdateBinding).toHaveBeenCalledTimes(1);
    const [, , patch] = onUpdateBinding.mock.calls[0];
    expect(patch).not.toHaveProperty("normalizedKey");
    expect(patch).toMatchObject({ required: true });
  });

  test("clearing the normalizedKey input commits as 'no override' (reverts any prior override)", () => {
    const regionWithOverride: RegionDraft = {
      ...region,
      columnBindings: [
        {
          sourceLocator: "header:Email",
          columnDefinitionId: "coldef_email",
          columnDefinitionLabel: "Email",
          confidence: 0.9,
          normalizedKey: "prior_override",
        },
      ],
    };
    const onUpdateBinding = jest.fn();
    render(
      <ReviewStepUI
        regions={[regionWithOverride]}
        overallConfidence={0.85}
        onJumpToRegion={jest.fn()}
        onEditBinding={jest.fn()}
        onUpdateBinding={onUpdateBinding}
        onToggleBindingExcluded={jest.fn()}
        columnDefinitionSearch={makeSearchStub()}
        onCommit={jest.fn()}
        onBack={jest.fn()}
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: /edit binding.*header:email/i })
    );
    const nk = screen.getByLabelText(/normalized key/i) as HTMLInputElement;
    // Clear the field.
    fireEvent.change(nk, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(onUpdateBinding).toHaveBeenCalledWith(
      "region-a",
      "header:Email",
      expect.objectContaining({ normalizedKey: undefined })
    );
  });

  test("Commit stays disabled while any binding carries a validation error", () => {
    const regionWithBadBinding: RegionDraft = {
      ...region,
      columnBindings: [
        {
          sourceLocator: "header:Email",
          columnDefinitionId: "coldef_email",
          columnDefinitionLabel: "Email",
          confidence: 0.9,
          // Two bindings with the same override → collision.
          normalizedKey: "dup_key",
        },
        {
          sourceLocator: "col:3",
          columnDefinitionId: "coldef_name",
          columnDefinitionLabel: "Name",
          confidence: 0.7,
          normalizedKey: "dup_key",
        },
      ],
    };
    render(
      <ReviewStepUI
        regions={[regionWithBadBinding]}
        overallConfidence={0.85}
        onJumpToRegion={jest.fn()}
        onEditBinding={jest.fn()}
        onUpdateBinding={jest.fn()}
        onToggleBindingExcluded={jest.fn()}
        columnDefinitionSearch={makeSearchStub()}
        onCommit={jest.fn()}
        onBack={jest.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /commit plan/i })
    ).toBeDisabled();
    expect(
      screen.getByText(/bindings have validation errors/i)
    ).toBeInTheDocument();
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
