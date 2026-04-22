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
    orientation: "rows-as-records",
    headerAxis: "row",
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

  test("shows pivoted records-axis input when columns-as-records + headerAxis:row", () => {
    render(
      <RegionConfigurationPanelUI
        region={baseRegion({
          orientation: "columns-as-records",
          headerAxis: "row",
        })}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByText(/Records-axis name/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Month, Region, Year/i)
    ).toBeInTheDocument();
  });

  test("crosstab orientation shows row/col axis and cell-value-name inputs", () => {
    render(
      <RegionConfigurationPanelUI
        region={baseRegion({
          orientation: "cells-as-records",
          headerAxis: "row",
        })}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByText(/Row-axis name/i)).toBeInTheDocument();
    expect(screen.getByText(/Column-axis name/i)).toBeInTheDocument();
    expect(screen.getByText(/Cell value name/i)).toBeInTheDocument();
  });

  test("field-names editor appears when headerAxis is 'none'", () => {
    const region = baseRegion({
      headerAxis: "none",
      bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 2 },
    });
    render(
      <RegionConfigurationPanelUI
        region={region}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByText(/Field names/i)).toBeInTheDocument();
    expect(screen.getByText("columnA")).toBeInTheDocument();
    expect(screen.getByText("columnB")).toBeInTheDocument();
    expect(screen.getByText("columnC")).toBeInTheDocument();
  });

  test("stop-pattern input appears when boundsMode is matchesPattern", () => {
    render(
      <RegionConfigurationPanelUI
        region={baseRegion({ boundsMode: "matchesPattern" })}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByLabelText(/Stop pattern/i)).toBeInTheDocument();
  });

  test("terminator input appears only for untilEmpty bounds mode", () => {
    const { rerender } = render(
      <RegionConfigurationPanelUI
        region={baseRegion({ boundsMode: "absolute" })}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(
      screen.queryByLabelText(/Terminator count/i)
    ).not.toBeInTheDocument();

    rerender(
      <RegionConfigurationPanelUI
        region={baseRegion({ boundsMode: "untilEmpty" })}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByLabelText(/Terminator count/i)).toBeInTheDocument();
  });

  test("toggling the blank skip rule adds and removes a rule", () => {
    const onUpdate = jest.fn();
    render(
      <RegionConfigurationPanelUI
        region={baseRegion({ boundsMode: "untilEmpty" })}
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
