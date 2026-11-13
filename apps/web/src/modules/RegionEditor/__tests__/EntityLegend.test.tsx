import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";

import { expectNoAxeViolations } from "../../../__tests__/test-utils";
import { EntityLegendUI } from "../EntityLegend.component";
import type { EntityLegendEntry } from "../utils/region-editor.types";

const ENTRIES: EntityLegendEntry[] = [
  { id: "ent_a", label: "Contact", entitySlot: "0", regionCount: 2 },
  { id: "ent_b", label: "Deal", entitySlot: "1", regionCount: 1 },
];

describe("EntityLegendUI", () => {
  test("renders each entity entry with its count", () => {
    render(<EntityLegendUI entries={ENTRIES} />);
    expect(screen.getByText("Contact")).toBeInTheDocument();
    expect(screen.getByText("Deal")).toBeInTheDocument();
    expect(screen.getByText("2 regions")).toBeInTheDocument();
    expect(screen.getByText("1 region")).toBeInTheDocument();
  });

  test("renders empty-state message when no entries", () => {
    render(<EntityLegendUI entries={[]} />);
    expect(screen.getByText(/no entities bound/i)).toBeInTheDocument();
  });

  test("invokes onEntitySelect when an entry is clicked", () => {
    const onSelect = jest.fn();
    render(<EntityLegendUI entries={ENTRIES} onEntitySelect={onSelect} />);
    fireEvent.click(screen.getByText("Contact"));
    expect(onSelect).toHaveBeenCalledWith("ent_a");
  });

  test("has no axe violations", async () => {
    const { container } = render(
      <EntityLegendUI entries={ENTRIES} onEntitySelect={jest.fn()} />
    );
    await expectNoAxeViolations(container);
  });

  test("has no axe violations when empty", async () => {
    const { container } = render(<EntityLegendUI entries={[]} />);
    await expectNoAxeViolations(container);
  });
});
