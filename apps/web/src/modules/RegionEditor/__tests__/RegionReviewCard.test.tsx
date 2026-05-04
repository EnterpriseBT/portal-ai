import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RegionReviewCardUI } from "../RegionReviewCard.component";
import type { RegionDraft } from "../utils/region-editor.types";

const makeRegion = (
  overrides: Partial<RegionDraft> = {}
): RegionDraft => ({
  id: "region-a",
  sheetId: "sheet_a",
  bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 2 },
  headerAxes: ["row"],
  segmentsByAxis: { row: [{ kind: "field", positionCount: 3 }] },
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

function setup(
  overrides: Partial<RegionDraft> = {},
  bindingErrors?: import("../utils/region-editor-validation.util").RegionBindingErrors
) {
  const onJump = jest.fn();
  const onEditBinding =
    jest.fn<(sourceLocator: string, anchorEl: HTMLElement) => void>();
  const utils = render(
    <RegionReviewCardUI
      region={makeRegion(overrides)}
      onJump={onJump}
      onEditBinding={onEditBinding}
      bindingErrors={bindingErrors}
    />
  );
  return { ...utils, onJump, onEditBinding };
}

describe("RegionReviewCardUI — excluded chip styling", () => {
  test("excluded chip carries the excluded status icon", () => {
    setup();
    expect(screen.getByTestId("chip-icon-excluded")).toBeInTheDocument();
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

  test("byHeaderName locator renders the header name as the chip's source label, not the raw locator", () => {
    setup({
      columnBindings: [
        {
          sourceLocator: "header:row:HQ",
          columnDefinitionId: "coldef_hq",
          columnDefinitionLabel: "HQ Office",
          confidence: 0.9,
        },
      ],
    });
    // The source label (HQ from the locator) renders alongside the
    // columnDefinitionLabel ("HQ Office"). The raw "header:row:HQ"
    // string never appears.
    expect(screen.getByText("HQ")).toBeInTheDocument();
    expect(screen.getByText("HQ Office")).toBeInTheDocument();
    expect(screen.queryByText("header:row:HQ")).not.toBeInTheDocument();
  });

  test("byPositionIndex locator with a normalizedKey override renders the override as the chip's source label", () => {
    setup({
      columnBindings: [
        {
          sourceLocator: "pos:row:1",
          columnDefinitionId: "coldef_year",
          columnDefinitionLabel: "Year",
          confidence: 0.9,
          normalizedKey: "year",
        },
      ],
    });
    expect(screen.getByText("year")).toBeInTheDocument();
    expect(screen.queryByText("pos:row:1")).not.toBeInTheDocument();
  });

  test("renders one chip per intersectionCellValueFields entry on a 2D crosstab and skips the region-level cellValueField chip", () => {
    setup({
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "rp1",
            axisName: "year",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
        column: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "cp1",
            axisName: "company",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
      },
      cellValueField: { name: "value", nameSource: "user" },
      intersectionCellValueFields: {
        rp1__cp1: {
          name: "revenue",
          nameSource: "user",
          columnDefinitionId: "coldef_revenue",
        },
      },
      columnBindings: [],
    });
    // Override surfaces as the chip's source label.
    expect(screen.getByText("revenue")).toBeInTheDocument();
    // Region-level "value" default no longer appears on the review card —
    // the override is the canonical name.
    expect(screen.queryByText("value")).not.toBeInTheDocument();
  });

  test("clicking an intersection chip emits the `intersection:<id>` synthetic locator", () => {
    const { onEditBinding } = setup({
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "rp1",
            axisName: "year",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
        column: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "cp1",
            axisName: "company",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
      },
      cellValueField: { name: "value", nameSource: "user" },
      intersectionCellValueFields: {
        rp1__cp1: { name: "revenue", nameSource: "user" },
      },
      columnBindings: [],
    });
    const chip = screen.getByRole("button", {
      name: /edit intersection cell value "revenue"/i,
    });
    fireEvent.click(chip);
    expect(onEditBinding).toHaveBeenCalledWith("intersection:rp1__cp1", chip);
  });

  test("byPositionIndex without a normalizedKey falls back to a positional placeholder", () => {
    setup({
      columnBindings: [
        {
          sourceLocator: "pos:row:2",
          columnDefinitionId: "coldef_other",
          columnDefinitionLabel: "Other",
          confidence: 0.7,
        },
      ],
    });
    // Don't show the raw "pos:row:2" — use a placeholder so the chip
    // still reads as a positional binding.
    expect(screen.queryByText("pos:row:2")).not.toBeInTheDocument();
    expect(screen.getByText(/Pos row 2/i)).toBeInTheDocument();
  });
});

describe("RegionReviewCardUI — pivot + cellValueField chips", () => {
  const pivotRegion: Partial<RegionDraft> = {
    id: "region-pivot",
    bounds: { startRow: 3, endRow: 6, startCol: 1, endCol: 6 },
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [
        {
          kind: "pivot",
          id: "pivot-1",
          axisName: "timestamp",
          axisNameSource: "user",
          positionCount: 6,
          columnDefinitionId: "coldef_timestamp",
        },
      ],
    },
    cellValueField: {
      name: "amount",
      nameSource: "user",
      columnDefinitionId: "coldef_amount",
    },
    columnBindings: [],
  };

  test("renders a chip per pivot segment, resolving the label via resolveColumnLabel", () => {
    const resolveColumnLabel = jest.fn((id: string) =>
      id === "coldef_timestamp"
        ? "Timestamp"
        : id === "coldef_amount"
          ? "Amount"
          : undefined
    );
    render(
      <RegionReviewCardUI
        region={makeRegion(pivotRegion)}
        onJump={jest.fn()}
        onEditBinding={jest.fn()}
        resolveColumnLabel={resolveColumnLabel}
      />
    );
    // Pivot axisName chip: source = "timestamp", label = "Timestamp"
    expect(screen.getByText("timestamp")).toBeInTheDocument();
    expect(screen.getByText("Timestamp")).toBeInTheDocument();
    // CellValueField chip: source = "amount", label = "Amount"
    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.getByText("Amount")).toBeInTheDocument();
  });

  test("clicking a pivot chip fires onEditBinding with a `pivot:<segId>` synthetic locator", () => {
    const onEditBinding =
      jest.fn<(sourceLocator: string, anchorEl: HTMLElement) => void>();
    render(
      <RegionReviewCardUI
        region={makeRegion(pivotRegion)}
        onJump={jest.fn()}
        onEditBinding={onEditBinding}
        resolveColumnLabel={(id) =>
          id === "coldef_timestamp" ? "Timestamp" : "Amount"
        }
      />
    );
    const pivotChip = screen.getByRole("button", {
      name: /edit pivot axis "timestamp"/i,
    });
    fireEvent.click(pivotChip);
    expect(onEditBinding).toHaveBeenCalledWith("pivot:pivot-1", pivotChip);
  });

  test("clicking a cellValueField chip fires onEditBinding with the `cellValueField` synthetic locator", () => {
    const onEditBinding =
      jest.fn<(sourceLocator: string, anchorEl: HTMLElement) => void>();
    render(
      <RegionReviewCardUI
        region={makeRegion(pivotRegion)}
        onJump={jest.fn()}
        onEditBinding={onEditBinding}
        resolveColumnLabel={(id) =>
          id === "coldef_timestamp" ? "Timestamp" : "Amount"
        }
      />
    );
    const cellChip = screen.getByRole("button", {
      name: /edit cell value "amount"/i,
    });
    fireEvent.click(cellChip);
    expect(onEditBinding).toHaveBeenCalledWith("cellValueField", cellChip);
  });

  test("excluded pivot chip shows the 'Excluded' pill and aria-label", () => {
    render(
      <RegionReviewCardUI
        region={makeRegion({
          ...pivotRegion,
          segmentsByAxis: {
            row: [
              {
                kind: "pivot",
                id: "pivot-1",
                axisName: "timestamp",
                axisNameSource: "user",
                positionCount: 6,
                columnDefinitionId: "coldef_timestamp",
                excluded: true,
              },
            ],
          },
        })}
        onJump={jest.fn()}
        onEditBinding={jest.fn()}
        resolveColumnLabel={(id) =>
          id === "coldef_timestamp" ? "Timestamp" : undefined
        }
      />
    );
    expect(
      screen.getByRole("button", {
        name: /excluded.*pivot axis "timestamp"/i,
      })
    ).toBeInTheDocument();
    expect(screen.getByTestId("chip-icon-excluded")).toBeInTheDocument();
  });

  test("excluded cellValueField chip shows the 'Excluded' pill and aria-label", () => {
    render(
      <RegionReviewCardUI
        region={makeRegion({
          ...pivotRegion,
          cellValueField: {
            name: "amount",
            nameSource: "user",
            columnDefinitionId: "coldef_amount",
            excluded: true,
          },
        })}
        onJump={jest.fn()}
        onEditBinding={jest.fn()}
        resolveColumnLabel={(id) =>
          id === "coldef_amount" ? "Amount" : undefined
        }
      />
    );
    expect(
      screen.getByRole("button", {
        name: /excluded.*cell value "amount"/i,
      })
    ).toBeInTheDocument();
  });

  test("unbound pivot segments and cellValueFields render the unbound status icon", () => {
    render(
      <RegionReviewCardUI
        region={makeRegion({
          ...pivotRegion,
          segmentsByAxis: {
            row: [
              {
                kind: "pivot",
                id: "pivot-1",
                axisName: "timestamp",
                axisNameSource: "user",
                positionCount: 6,
                // no columnDefinitionId — classifier didn't find a match.
              },
            ],
          },
          cellValueField: {
            name: "amount",
            nameSource: "user",
            // no columnDefinitionId either.
          },
        })}
        onJump={jest.fn()}
        onEditBinding={jest.fn()}
      />
    );
    expect(screen.getAllByTestId("chip-icon-unbound").length).toBe(2);
  });

  test("non-pivoted region shows no logical-field chips even when resolver is supplied", () => {
    render(
      <RegionReviewCardUI
        region={makeRegion()}
        onJump={jest.fn()}
        onEditBinding={jest.fn()}
        resolveColumnLabel={() => "Anything"}
      />
    );
    // The fixture has no pivot segments and no cellValueField — only the
    // existing columnBindings chips should render.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("RegionReviewCardUI — invalid chip styling", () => {
  test("chips with entries in bindingErrors carry an invalid aria-label + invalid status icon", () => {
    setup(
      {},
      {
        "header:Email": { normalizedKey: "duplicate override" },
      }
    );
    const invalidChip = screen.getByRole("button", {
      name: /invalid.*header:email/i,
    });
    expect(invalidChip).toBeInTheDocument();
    // Surfaces an invalid status icon next to the chip content so the user
    // can spot problem bindings without clicking each one.
    expect(screen.getByTestId("chip-icon-invalid")).toBeInTheDocument();
  });

  test("non-invalid chips are unaffected when bindingErrors is supplied for others", () => {
    setup(
      {},
      {
        "header:Email": { normalizedKey: "duplicate override" },
      }
    );
    // The excluded chip is still labelled "Excluded" (takes precedence in
    // aria-label — excluded bindings don't carry validation errors).
    expect(
      screen.getByRole("button", { name: /excluded.*col:3/i })
    ).toBeInTheDocument();
  });

  test("no bindingErrors prop → no invalid status icon anywhere", () => {
    setup();
    expect(screen.queryByTestId("chip-icon-invalid")).not.toBeInTheDocument();
  });
});

describe("RegionReviewCardUI — IdentityPanel", () => {
  test("renders the IdentityPanel when locator options + onIdentityUpdate are provided", () => {
    const onIdentityUpdate =
      jest.fn<
        (
          regionId: string,
          change:
            | {
                kind: "column";
                locator: { axis: "row" | "column"; index: number };
              }
            | { kind: "rowPosition" }
        ) => void
      >();
    render(
      <RegionReviewCardUI
        region={makeRegion()}
        onJump={jest.fn()}
        onEditBinding={jest.fn()}
        identityLocatorOptions={[
          {
            key: "col:0",
            label: "id",
            uniqueness: "unique",
            axis: "column",
            index: 0,
          },
        ]}
        onIdentityUpdate={onIdentityUpdate}
      />
    );
    expect(
      screen.getByText(/no stable identity|record identity/i)
    ).toBeInTheDocument();
  });

  test("does not render the IdentityPanel when the prop pair is missing", () => {
    render(
      <RegionReviewCardUI
        region={makeRegion()}
        onJump={jest.fn()}
        onEditBinding={jest.fn()}
      />
    );
    expect(screen.queryByText(/use position-based ids/i)).toBeNull();
  });

  test("propagates onIdentityUpdate calls with the region id from the card", () => {
    const onIdentityUpdate =
      jest.fn<
        (
          regionId: string,
          change:
            | {
                kind: "column";
                locator: { axis: "row" | "column"; index: number };
              }
            | { kind: "rowPosition" }
        ) => void
      >();
    render(
      <RegionReviewCardUI
        region={makeRegion()}
        onJump={jest.fn()}
        onEditBinding={jest.fn()}
        identityLocatorOptions={[
          {
            key: "col:0",
            label: "id",
            uniqueness: "unique",
            axis: "column",
            index: 0,
          },
        ]}
        onIdentityUpdate={onIdentityUpdate}
      />
    );
    fireEvent.mouseDown(screen.getByRole("combobox"));
    // Pick the "id" locator option from the menu — `role="option"`
    // disambiguates from the rendered Select input value (which would
    // otherwise duplicate the matching text when the current selection is
    // already rowPosition).
    fireEvent.click(screen.getByRole("option", { name: /^id\b/i }));
    expect(onIdentityUpdate).toHaveBeenCalledTimes(1);
    expect(onIdentityUpdate).toHaveBeenCalledWith("region-a", {
      kind: "column",
      locator: { axis: "column", index: 0 },
    });
  });
});

describe("RegionReviewCardUI — chip sort", () => {
  function ariaLabelOrder(): string[] {
    return screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? "");
  }

  test("renders invalid chips before unbound chips", () => {
    setup(
      {
        columnBindings: [
          {
            sourceLocator: "header:UnboundField",
            columnDefinitionId: null,
            confidence: 0.4,
          },
          {
            sourceLocator: "header:InvalidField",
            columnDefinitionId: "coldef_email",
            columnDefinitionLabel: "Email",
            confidence: 0.9,
          },
        ],
      },
      {
        "header:InvalidField": { normalizedKey: "duplicate override" },
      }
    );
    const labels = ariaLabelOrder();
    const invalidIdx = labels.findIndex((l) => /InvalidField/i.test(l));
    const unboundIdx = labels.findIndex((l) => /UnboundField/i.test(l));
    expect(invalidIdx).toBeGreaterThan(-1);
    expect(unboundIdx).toBeGreaterThan(-1);
    expect(invalidIdx).toBeLessThan(unboundIdx);
  });

  test("renders unbound chips before bound chips", () => {
    setup({
      columnBindings: [
        {
          sourceLocator: "header:BoundOne",
          columnDefinitionId: "coldef_one",
          columnDefinitionLabel: "Bound One",
          confidence: 0.9,
        },
        {
          sourceLocator: "header:UnboundField",
          columnDefinitionId: null,
          confidence: 0.3,
        },
        {
          sourceLocator: "header:BoundTwo",
          columnDefinitionId: "coldef_two",
          columnDefinitionLabel: "Bound Two",
          confidence: 0.8,
        },
      ],
    });
    const labels = ariaLabelOrder();
    const unboundIdx = labels.findIndex((l) => /UnboundField/i.test(l));
    const boundOneIdx = labels.findIndex((l) => /BoundOne/i.test(l));
    expect(unboundIdx).toBeGreaterThan(-1);
    expect(boundOneIdx).toBeGreaterThan(-1);
    expect(unboundIdx).toBeLessThan(boundOneIdx);
  });

  test("sorts bound chips alphabetically by source", () => {
    setup({
      columnBindings: [
        {
          sourceLocator: "header:Zip",
          columnDefinitionId: "coldef_zip",
          columnDefinitionLabel: "Zip",
          confidence: 0.9,
        },
        {
          sourceLocator: "header:Address",
          columnDefinitionId: "coldef_addr",
          columnDefinitionLabel: "Address",
          confidence: 0.9,
        },
        {
          sourceLocator: "header:Name",
          columnDefinitionId: "coldef_name",
          columnDefinitionLabel: "Name",
          confidence: 0.9,
        },
      ],
    });
    const labels = ariaLabelOrder();
    const addressIdx = labels.findIndex((l) => /Address/i.test(l));
    const nameIdx = labels.findIndex((l) => /header:Name/i.test(l));
    const zipIdx = labels.findIndex((l) => /Zip/i.test(l));
    expect(addressIdx).toBeLessThan(nameIdx);
    expect(nameIdx).toBeLessThan(zipIdx);
  });

  test("renders excluded chips last", () => {
    setup(
      {
        columnBindings: [
          {
            sourceLocator: "header:ExcludedField",
            columnDefinitionId: "coldef_e",
            columnDefinitionLabel: "Excluded",
            confidence: 0.9,
            excluded: true,
          },
          {
            sourceLocator: "header:BoundField",
            columnDefinitionId: "coldef_b",
            columnDefinitionLabel: "Bound",
            confidence: 0.9,
          },
          {
            sourceLocator: "header:InvalidField",
            columnDefinitionId: "coldef_i",
            columnDefinitionLabel: "Invalid",
            confidence: 0.9,
          },
        ],
      },
      {
        "header:InvalidField": { normalizedKey: "dup" },
      }
    );
    const labels = ariaLabelOrder();
    const excludedIdx = labels.findIndex((l) => /ExcludedField/i.test(l));
    const boundIdx = labels.findIndex((l) => /BoundField/i.test(l));
    const invalidIdx = labels.findIndex((l) => /InvalidField/i.test(l));
    expect(invalidIdx).toBeLessThan(boundIdx);
    expect(boundIdx).toBeLessThan(excludedIdx);
  });

  test("breaks ties alphabetically within a priority bucket", () => {
    setup(
      {
        columnBindings: [
          {
            sourceLocator: "header:C",
            columnDefinitionId: "coldef_c",
            columnDefinitionLabel: "C",
            confidence: 0.9,
          },
          {
            sourceLocator: "header:A",
            columnDefinitionId: "coldef_a",
            columnDefinitionLabel: "A",
            confidence: 0.9,
          },
          {
            sourceLocator: "header:B",
            columnDefinitionId: "coldef_b",
            columnDefinitionLabel: "B",
            confidence: 0.9,
          },
        ],
      },
      {
        "header:C": { normalizedKey: "x" },
        "header:A": { normalizedKey: "x" },
        "header:B": { normalizedKey: "x" },
      }
    );
    const labels = ariaLabelOrder();
    const aIdx = labels.findIndex((l) => /header:A/i.test(l));
    const bIdx = labels.findIndex((l) => /header:B/i.test(l));
    const cIdx = labels.findIndex((l) => /header:C/i.test(l));
    expect(aIdx).toBeLessThan(bIdx);
    expect(bIdx).toBeLessThan(cIdx);
  });

  // (filter tests below need >8-chip fixtures; see manyBindings helper.)

  test("includes pivot and intersection chips in the sort", () => {
    setup({
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "rp1",
            axisName: "year",
            axisNameSource: "user",
            positionCount: 4,
            // unbound — no columnDefinitionId
          },
        ],
        column: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "cp1",
            axisName: "company",
            axisNameSource: "user",
            positionCount: 4,
            columnDefinitionId: "coldef_company",
          },
        ],
      },
      cellValueField: { name: "value", nameSource: "user" },
      intersectionCellValueFields: {
        rp1__cp1: {
          name: "revenue",
          nameSource: "user",
          // unbound — no columnDefinitionId
        },
      },
      columnBindings: [],
    });
    const labels = ariaLabelOrder();
    const yearIdx = labels.findIndex((l) => /pivot axis "year"/i.test(l));
    const revenueIdx = labels.findIndex((l) =>
      /intersection cell value "revenue"/i.test(l)
    );
    const companyIdx = labels.findIndex((l) => /pivot axis "company"/i.test(l));
    // year and revenue are unbound (priority 1); company is bound (priority 2).
    expect(yearIdx).toBeLessThan(companyIdx);
    expect(revenueIdx).toBeLessThan(companyIdx);
  });
});

describe("RegionReviewCardUI — chip filter", () => {
  /**
   * Build N bound bindings, with optional overrides for a few specific
   * indices. Sources are alphabetic ("aaa", "aab", "aac", …) so default sort
   * is stable.
   */
  type Binding = NonNullable<RegionDraft["columnBindings"]>[number];

  function manyBindings(
    count: number,
    overrides: Record<number, Partial<Binding>> = {}
  ): Binding[] {
    return Array.from({ length: count }, (_, i) => {
      const source = `field_${String.fromCharCode(97 + i)}`;
      return {
        sourceLocator: `header:${source}`,
        columnDefinitionId: `coldef_${i}`,
        columnDefinitionLabel: `Field ${i}`,
        confidence: 0.9,
        ...(overrides[i] ?? {}),
      };
    });
  }

  test("hides the filter input when chips.length is at threshold (8)", () => {
    setup({ columnBindings: manyBindings(8) });
    expect(screen.queryByLabelText(/filter region fields/i)).toBeNull();
  });

  test("shows the filter input when chips.length exceeds threshold (9)", () => {
    setup({ columnBindings: manyBindings(9) });
    expect(
      screen.getByLabelText(/filter region fields/i)
    ).toBeInTheDocument();
  });

  test("filters by source substring (case-insensitive)", async () => {
    const user = userEvent.setup();
    setup({
      columnBindings: manyBindings(9, {
        0: {
          sourceLocator: "header:customer_email",
          columnDefinitionLabel: "Customer Email",
        },
        1: {
          sourceLocator: "header:customer_phone",
          columnDefinitionLabel: "Customer Phone",
        },
      }),
    });
    const input = screen.getByLabelText(/filter region fields/i);
    await user.type(input, "email");
    expect(
      screen.getByRole("button", { name: /header:customer_email/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /header:customer_phone/i })
    ).toBeNull();
  });

  test("filters by columnDefinitionLabel", async () => {
    const user = userEvent.setup();
    setup({
      columnBindings: manyBindings(9, {
        3: {
          sourceLocator: "header:opaque",
          columnDefinitionLabel: "Customer Email",
        },
      }),
    });
    const input = screen.getByLabelText(/filter region fields/i);
    await user.type(input, "customer");
    expect(
      screen.getByRole("button", { name: /header:opaque/i })
    ).toBeInTheDocument();
  });

  test("filters by columnDefinitionId", async () => {
    const user = userEvent.setup();
    setup({
      columnBindings: manyBindings(9, {
        5: {
          sourceLocator: "header:shipping_addr",
          columnDefinitionId: "coldef_email_address",
          columnDefinitionLabel: "Email",
        },
      }),
    });
    const input = screen.getByLabelText(/filter region fields/i);
    await user.type(input, "email_addr");
    expect(
      screen.getByRole("button", { name: /header:shipping_addr/i })
    ).toBeInTheDocument();
  });

  test("returns all chips when filter is cleared", async () => {
    const user = userEvent.setup();
    setup({ columnBindings: manyBindings(9) });
    const input = screen.getByLabelText(/filter region fields/i);
    await user.type(input, "field_a");
    expect(screen.getAllByRole("button").length).toBeLessThan(9);
    await user.clear(input);
    // 9 chip buttons (other buttons in the card: Jump). Filter all cleared.
    expect(
      screen.getAllByRole("button", { name: /header:field_/i }).length
    ).toBe(9);
  });

  test('renders "No fields match." when filter has zero matches', async () => {
    const user = userEvent.setup();
    setup({ columnBindings: manyBindings(9) });
    const input = screen.getByLabelText(/filter region fields/i);
    await user.type(input, "zzznope");
    expect(screen.getByText(/no fields match\./i)).toBeInTheDocument();
    expect(
      screen.queryAllByRole("button", { name: /header:field_/i }).length
    ).toBe(0);
  });

  test("filter is case-insensitive", async () => {
    const user = userEvent.setup();
    setup({
      columnBindings: manyBindings(9, {
        2: {
          sourceLocator: "header:Customer_Email",
          columnDefinitionLabel: "Customer Email",
        },
      }),
    });
    const input = screen.getByLabelText(/filter region fields/i);
    await user.type(input, "EMAIL");
    expect(
      screen.getByRole("button", { name: /Customer_Email/i })
    ).toBeInTheDocument();
  });

  test("filtered chips render in priority + alphabetical order", async () => {
    const user = userEvent.setup();
    setup(
      {
        columnBindings: manyBindings(9, {
          0: {
            sourceLocator: "header:zebra_field",
            columnDefinitionLabel: "Zebra Field",
          },
          1: {
            sourceLocator: "header:alpha_field",
            columnDefinitionLabel: "Alpha Field",
          },
          2: {
            sourceLocator: "header:beta_invalid",
            columnDefinitionLabel: "Beta Invalid",
          },
        }),
      },
      {
        "header:beta_invalid": { normalizedKey: "dup" },
      }
    );
    const input = screen.getByLabelText(/filter region fields/i);
    await user.type(input, "field");
    const labels = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label") ?? "");
    const alphaIdx = labels.findIndex((l) => /alpha_field/i.test(l));
    const zebraIdx = labels.findIndex((l) => /zebra_field/i.test(l));
    // Both surviving chips are bound (priority 2), so alphabetical order:
    // alpha_field before zebra_field.
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(zebraIdx).toBeGreaterThan(-1);
    expect(alphaIdx).toBeLessThan(zebraIdx);
  });
});

describe("RegionReviewCardUI — status icon", () => {
  test("bound chip renders the bound status icon", () => {
    setup({
      columnBindings: [
        {
          sourceLocator: "header:Email",
          columnDefinitionId: "coldef_email",
          columnDefinitionLabel: "Email",
          confidence: 0.9,
        },
      ],
    });
    expect(screen.getByTestId("chip-icon-bound")).toBeInTheDocument();
  });

  test("unbound chip renders the unbound status icon", () => {
    setup({
      columnBindings: [
        {
          sourceLocator: "header:Mystery",
          columnDefinitionId: null,
          confidence: 0.3,
        },
      ],
    });
    expect(screen.getByTestId("chip-icon-unbound")).toBeInTheDocument();
  });

  test("invalid chip renders the invalid status icon", () => {
    setup(
      {
        columnBindings: [
          {
            sourceLocator: "header:Email",
            columnDefinitionId: "coldef_email",
            columnDefinitionLabel: "Email",
            confidence: 0.9,
          },
        ],
      },
      {
        "header:Email": { normalizedKey: "duplicate override" },
      }
    );
    expect(screen.getByTestId("chip-icon-invalid")).toBeInTheDocument();
  });

  test("excluded chip renders the excluded status icon", () => {
    setup({
      columnBindings: [
        {
          sourceLocator: "header:Skipped",
          columnDefinitionId: "coldef_skip",
          columnDefinitionLabel: "Skipped",
          confidence: 0.9,
          excluded: true,
        },
      ],
    });
    expect(screen.getByTestId("chip-icon-excluded")).toBeInTheDocument();
  });

  test("excluded chip retains line-through styling", () => {
    setup({
      columnBindings: [
        {
          sourceLocator: "header:Skipped",
          columnDefinitionId: "coldef_skip",
          columnDefinitionLabel: "Skipped",
          confidence: 0.9,
          excluded: true,
        },
      ],
    });
    const chip = screen.getByRole("button", { name: /excluded/i });
    expect(chip).toHaveStyle({ textDecoration: "line-through" });
  });
});
