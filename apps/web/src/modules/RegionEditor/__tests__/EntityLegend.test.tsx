import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";

import { EntityLegend } from "../EntityLegend.component";
import type { EntityLegendEntry } from "../utils/region-editor.types";

const ENTRIES: EntityLegendEntry[] = [
  { id: "ent_a", label: "Contact", color: "#2563eb", regionCount: 2 },
  { id: "ent_b", label: "Deal", color: "#db2777", regionCount: 1 },
];

describe("EntityLegend", () => {
  test("renders each entity entry with its count", () => {
    render(<EntityLegend entries={ENTRIES} />);
    expect(screen.getByText("Contact")).toBeInTheDocument();
    expect(screen.getByText("Deal")).toBeInTheDocument();
    expect(screen.getByText("2 regions")).toBeInTheDocument();
    expect(screen.getByText("1 region")).toBeInTheDocument();
  });

  test("renders empty-state message when no entries", () => {
    render(<EntityLegend entries={[]} />);
    expect(screen.getByText(/no entities bound/i)).toBeInTheDocument();
  });

  test("invokes onEntitySelect when an entry is clicked", () => {
    const onSelect = jest.fn();
    render(<EntityLegend entries={ENTRIES} onEntitySelect={onSelect} />);
    fireEvent.click(screen.getByText("Contact"));
    expect(onSelect).toHaveBeenCalledWith("ent_a");
  });
});
