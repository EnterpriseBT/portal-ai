import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";

import { RegionSidePanel } from "../RegionSidePanel.component";
import type { RegionDraft } from "../utils/region-editor.types";

const ENTITY_OPTIONS = [
  { value: "ent_a", label: "Contact" },
  { value: "ent_b", label: "Deal" },
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

describe("RegionSidePanel", () => {
  test("shows empty-state copy when no region is selected", () => {
    render(
      <RegionSidePanel
        region={null}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={[]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByText(/Draw a region on the canvas/i)).toBeInTheDocument();
  });

  test("renders region label and bounds caption", () => {
    render(
      <RegionSidePanel
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
      <RegionSidePanel
        region={baseRegion()}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={2}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.getByText(/merges into entity with 2 other regions/i)).toBeInTheDocument();
  });

  test("calls onDelete when the trash button is clicked", () => {
    const onDelete = jest.fn();
    render(
      <RegionSidePanel
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
      <RegionSidePanel
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
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ proposedLabel: "Pipeline" }));
  });

  test("displays entity-required error passed in props", () => {
    render(
      <RegionSidePanel
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
      <RegionSidePanel
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
    expect(screen.getByPlaceholderText(/Month, Region, Year/i)).toBeInTheDocument();
  });

  test("crosstab orientation shows row/col axis and cell-value-name inputs", () => {
    render(
      <RegionSidePanel
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
      <RegionSidePanel
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
      <RegionSidePanel
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
      <RegionSidePanel
        region={baseRegion({ boundsMode: "absolute" })}
        entityOptions={ENTITY_OPTIONS}
        entityOrder={["ent_a"]}
        siblingsInSameEntity={0}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />
    );
    expect(screen.queryByLabelText(/Terminator count/i)).not.toBeInTheDocument();

    rerender(
      <RegionSidePanel
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
      <RegionSidePanel
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
});
