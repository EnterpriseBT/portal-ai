import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";

import { RegionConfigurationPanelUI } from "../RegionConfigurationPanel.component";
import type { EntityOption, RegionDraft } from "../utils/region-editor.types";

const ENTITY_OPTIONS: EntityOption[] = [
  { value: "ent_a", label: "Contact", source: "db" },
  { value: "ent_b", label: "Deal", source: "db" },
];

function baseRegion(overrides: Partial<RegionDraft> = {}): RegionDraft {
  return {
    id: "r1",
    sheetId: "s1",
    bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 3 },
    targetEntityDefinitionId: "ent_a",
    targetEntityLabel: "Contact",
    ...overrides,
  };
}

describe("RegionConfigurationPanelUI", () => {
  test("shows empty-state copy when no region is selected", () => {
    render(
      <RegionConfigurationPanelUI
        region={null}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={[]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(
      screen.getByText(/Draw a region on the canvas/i)
    ).toBeInTheDocument();
  });

  test("renders region label and bounds caption", () => {
    render(
      <RegionConfigurationPanelUI
        region={baseRegion({ proposedLabel: "Leads" })}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByText("Leads")).toBeInTheDocument();
    expect(screen.getByText(/A1:D5/)).toBeInTheDocument();
    expect(screen.getByText(/5 rows/)).toBeInTheDocument();
    expect(screen.getByText(/4 cols/)).toBeInTheDocument();
  });

  test("shows merge banner when siblings exist", () => {
    render(
      <RegionConfigurationPanelUI
        region={baseRegion()}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={2}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(
      screen.getByText(/merges into entity with 2 other regions/i)
    ).toBeInTheDocument();
  });

  test("calls onDelete when the trash button is clicked", () => {
    const onDelete = jest.fn();
    render(
      <RegionConfigurationPanelUI
        region={baseRegion()}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={onDelete}
      />
    );
    fireEvent.click(screen.getByLabelText(/delete region/i));
    expect(onDelete).toHaveBeenCalled();
  });

  test("updates proposedLabel on text input change", () => {
    const onUpdate = jest.fn();
    render(
      <RegionConfigurationPanelUI
        region={baseRegion()}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={onUpdate}
        onDelete={jest.fn()}
      />
    );
    const input = screen.getByPlaceholderText(/Optional region label/i);
    fireEvent.change(input, { target: { value: "Pipeline" } });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ proposedLabel: "Pipeline" })
    );
  });

  test("displays entity-required error passed in props", () => {
    render(
      <RegionConfigurationPanelUI
        region={baseRegion({ targetEntityDefinitionId: null })}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={[]}
        siblingsInSameEntity={0}
        errors={{ targetEntityDefinitionId: "Target entity is required" }}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByText(/Target entity is required/i)).toBeInTheDocument();
  });

  describe("PR-4 segment UI", () => {
    function segmentedRegion(
      overrides: Partial<RegionDraft> = {}
    ): RegionDraft {
      return baseRegion({
        headerAxes: ["row"],
        segmentsByAxis: {
          row: [{ kind: "field", positionCount: 4 }],
        },
        ...overrides,
      });
    }

    test("renders a SegmentStrip with one chip per segment", () => {
      render(
        <RegionConfigurationPanelUI
          region={segmentedRegion()}
          entityOptions={ENTITY_OPTIONS}
          entityOrder={["ent_a"]}
          siblingsInSameEntity={0}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      expect(screen.getByLabelText(/row segment strip/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /edit row segment 1 \(field\)/i })
      ).toBeInTheDocument();
    });

    test("renders the cell-value-field name input when a pivot segment exists", () => {
      render(
        <RegionConfigurationPanelUI
          region={segmentedRegion({
            segmentsByAxis: {
              row: [
                {
                  kind: "pivot",
                  id: "p1",
                  axisName: "Quarter",
                  axisNameSource: "user",
                  positionCount: 4,
                },
              ],
            },
            cellValueField: { name: "Revenue", nameSource: "user" },
          })}
          entityOptions={ENTITY_OPTIONS}
          entityOrder={["ent_a"]}
          siblingsInSameEntity={0}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      const input = screen.getByLabelText(/cell-value field name/i);
      expect(input).toHaveValue("Revenue");
    });

    test("does not render the cell-value-field input when no pivot segments exist", () => {
      render(
        <RegionConfigurationPanelUI
          region={segmentedRegion()}
          entityOptions={ENTITY_OPTIONS}
          entityOrder={["ent_a"]}
          siblingsInSameEntity={0}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      expect(
        screen.queryByLabelText(/cell-value field name/i)
      ).not.toBeInTheDocument();
    });

    test("renders an 'Add column axis' button when only the row axis is present", () => {
      render(
        <RegionConfigurationPanelUI
          region={segmentedRegion()}
          entityOptions={ENTITY_OPTIONS}
          entityOrder={["ent_a"]}
          siblingsInSameEntity={0}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      expect(
        screen.getByRole("button", { name: /add column header axis/i })
      ).toBeInTheDocument();
    });

    test("renders an Extent control for 1D regions and hides it for crosstabs", () => {
      const { rerender } = render(
        <RegionConfigurationPanelUI
          region={segmentedRegion()}
          entityOptions={ENTITY_OPTIONS}
          entityOrder={["ent_a"]}
          siblingsInSameEntity={0}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      expect(
        screen.getByRole("button", { name: /extent: fixed bounds/i })
      ).toBeInTheDocument();

      rerender(
        <RegionConfigurationPanelUI
          region={segmentedRegion({
            headerAxes: ["row", "column"],
            segmentsByAxis: {
              row: [
                { kind: "skip", positionCount: 1 },
                {
                  kind: "pivot",
                  id: "p1",
                  axisName: "Region",
                  axisNameSource: "user",
                  positionCount: 3,
                },
              ],
              column: [
                { kind: "skip", positionCount: 1 },
                {
                  kind: "pivot",
                  id: "p2",
                  axisName: "Quarter",
                  axisNameSource: "user",
                  positionCount: 3,
                },
              ],
            },
            cellValueField: { name: "Revenue", nameSource: "user" },
          })}
          entityOptions={ENTITY_OPTIONS}
          entityOrder={["ent_a"]}
          siblingsInSameEntity={0}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      expect(
        screen.queryByRole("button", { name: /extent:/i })
      ).not.toBeInTheDocument();
    });

    test("surfaces dynamic-tail state in the chip label when segment.dynamic is set", () => {
      render(
        <RegionConfigurationPanelUI
          region={segmentedRegion({
            segmentsByAxis: {
              row: [
                {
                  kind: "pivot",
                  id: "p1",
                  axisName: "Quarter",
                  axisNameSource: "user",
                  positionCount: 4,
                  dynamic: {
                    terminator: {
                      kind: "untilBlank",
                      consecutiveBlanks: 2,
                    },
                  },
                },
              ],
            },
            cellValueField: { name: "Revenue", nameSource: "user" },
          })}
          entityOptions={ENTITY_OPTIONS}
          entityOrder={["ent_a"]}
          siblingsInSameEntity={0}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      expect(screen.getByText(/quarter · 4 · ∞/i)).toBeInTheDocument();
    });

    test("no longer renders the orientation dropdown or boundsMode toggle", () => {
      render(
        <RegionConfigurationPanelUI
          region={segmentedRegion()}
          entityOptions={ENTITY_OPTIONS}
          entityOrder={["ent_a"]}
          siblingsInSameEntity={0}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      // Pre-PR-4 headings that should be gone.
      expect(screen.queryByText(/^Orientation$/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^Header axis$/)).not.toBeInTheDocument();
      // The per-kind buttons from the ToggleRow are gone too.
      expect(
        screen.queryByRole("button", { name: /^Fixed$/ })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /Until empty/i })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /^Rows$/ })
      ).not.toBeInTheDocument();
    });
  });

  test("toggling the blank skip rule adds and removes a rule", () => {
    const onUpdate = jest.fn();
    render(
      <RegionConfigurationPanelUI
        region={baseRegion()}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={onUpdate}
        onDelete={jest.fn()}
      />
    );
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ skipRules: [{ kind: "blank" }] })
    );
  });

  describe("C2 picker labels", () => {
    test("DB-backed options render as '<label> — <connectorInstanceName>' when provided", () => {
      const options: EntityOption[] = [
        {
          value: "ent_a",
          label: "Contact",
          source: "db",
          connectorInstanceName: "CRM Export",
        },
      ];
      render(
        <RegionConfigurationPanelUI
          region={baseRegion({ targetEntityDefinitionId: "ent_a" })}
          entityOptions={options}
          entityOrder={["ent_a"]}
          siblingsInSameEntity={0}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      expect(screen.getByText(/Contact\s+—\s+CRM Export/)).toBeInTheDocument();
    });

    test("DB-backed options without connectorInstanceName render as plain label", () => {
      const options: EntityOption[] = [
        { value: "ent_a", label: "Contact", source: "db" },
      ];
      render(
        <RegionConfigurationPanelUI
          region={baseRegion({ targetEntityDefinitionId: "ent_a" })}
          entityOptions={options}
          entityOrder={["ent_a"]}
          siblingsInSameEntity={0}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      // No "— <connector>" suffix appears anywhere in the rendered output.
      expect(screen.queryByText(/Contact\s+—/)).not.toBeInTheDocument();
    });

    test("staged options are unaffected by the connector suffix", () => {
      const options: EntityOption[] = [
        {
          value: "ent_draft",
          label: "Lead",
          source: "staged",
          // even if a connectorInstanceName slipped in, staged wins
          connectorInstanceName: "should-not-render",
        },
      ];
      render(
        <RegionConfigurationPanelUI
          region={baseRegion({ targetEntityDefinitionId: "ent_draft" })}
          entityOptions={options}
          entityOrder={["ent_draft"]}
          siblingsInSameEntity={0}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      expect(screen.getByText(/Lead\s+—\s+new/)).toBeInTheDocument();
      expect(
        screen.queryByText(/should-not-render/)
      ).not.toBeInTheDocument();
    });
  });

  test("staged entities render with a '— new' suffix", () => {
    const options: EntityOption[] = [
      ...ENTITY_OPTIONS,
      { value: "ent_draft", label: "Lead", source: "staged" },
    ];
    render(
      <RegionConfigurationPanelUI
        region={baseRegion({
          targetEntityDefinitionId: "ent_draft",
          targetEntityLabel: "Lead",
        })}
        entityOptions={options}
        entityOrder={["ent_draft"]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    // The selected option is rendered inside the Select button.
    expect(screen.getByText(/Lead\s+—\s+new/)).toBeInTheDocument();
  });

  test("hides '+ Create new entity' button when onCreateEntity is not provided", () => {
    render(
      <RegionConfigurationPanelUI
        region={baseRegion()}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(
      screen.queryByRole("button", { name: /create new entity/i })
    ).not.toBeInTheDocument();
  });

  test("shows '+ Create new entity' button when onCreateEntity is provided", () => {
    render(
      <RegionConfigurationPanelUI
        region={baseRegion()}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
        onCreateEntity={jest.fn<(key: string, label: string) => string>()}
      />
    );
    expect(
      screen.getByRole("button", { name: /create new entity/i })
    ).toBeInTheDocument();
  });

  describe("C1 entity picker", () => {
    function openPicker() {
      const select = screen.getByRole("combobox", { name: /target entity/i });
      fireEvent.mouseDown(select);
    }

    test("disables options claimed by other regions", () => {
      render(
        <RegionConfigurationPanelUI
          region={baseRegion({ targetEntityDefinitionId: null })}
          entityOptions={ENTITY_OPTIONS}
          entityOrder={[]}
          siblingsInSameEntity={0}
          claimedEntityKeys={new Set(["ent_a"])}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      openPicker();
      const contactOption = screen.getByRole("option", { name: /Contact/i });
      expect(contactOption).toHaveAttribute("aria-disabled", "true");
      const dealOption = screen.getByRole("option", { name: /Deal/i });
      expect(dealOption).not.toHaveAttribute("aria-disabled", "true");
    });

    test("keeps the currently-editing region's own target selectable", () => {
      render(
        <RegionConfigurationPanelUI
          region={baseRegion({ targetEntityDefinitionId: "ent_b" })}
          entityOptions={ENTITY_OPTIONS}
          entityOrder={["ent_b"]}
          siblingsInSameEntity={0}
          claimedEntityKeys={new Set(["ent_b"])}
          onUpdate={jest.fn()}
          onDelete={jest.fn()}
        />
      );
      openPicker();
      const dealOption = screen.getByRole("option", { name: /Deal/i });
      expect(dealOption).not.toHaveAttribute("aria-disabled", "true");
    });
  });

  test("renders an Identity help tooltip next to the section heading", () => {
    render(
      <RegionConfigurationPanelUI
        region={baseRegion()}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    const help = screen.getByLabelText("What is the target entity?");
    expect(help).toBeInTheDocument();
  });
});
