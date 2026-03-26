import React from "react";
import { render, screen } from "@testing-library/react";

import { DataTableBlock } from "../../ui/DataTableBlock";

describe("DataTableBlock", () => {
  const columns = ["id", "name", "revenue"];
  const rows = [
    { id: 1, name: "Alice", revenue: 100 },
    { id: 2, name: "Bob", revenue: 200 },
  ];

  it("renders column headers", () => {
    render(<DataTableBlock columns={columns} rows={rows} />);
    for (const col of columns) {
      expect(screen.getByText(col)).toBeInTheDocument();
    }
  });

  it("renders row data", () => {
    render(<DataTableBlock columns={columns} rows={rows} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
  });

  it("renders null values as empty string", () => {
    const rowsWithNull = [{ id: 1, name: null, revenue: undefined }];
    render(
      <DataTableBlock
        columns={columns}
        rows={rowsWithNull as unknown as Record<string, unknown>[]}
      />
    );
    // Should not throw, id should render
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("truncates at 50 rows and shows row count label", () => {
    const manyRows = Array.from({ length: 75 }, (_, i) => ({
      id: i,
      name: `Row ${i}`,
    }));
    render(<DataTableBlock columns={["id", "name"]} rows={manyRows} />);

    expect(screen.getByTestId("row-count-label")).toHaveTextContent(
      "Showing 50 of 75 rows"
    );

    // Row 0 should be visible, row 74 should not
    expect(screen.getByText("Row 0")).toBeInTheDocument();
    expect(screen.queryByText("Row 74")).not.toBeInTheDocument();
  });

  it("does not show row count label when under 50 rows", () => {
    render(<DataTableBlock columns={columns} rows={rows} />);
    expect(screen.queryByTestId("row-count-label")).not.toBeInTheDocument();
  });

  it("renders empty table when no rows", () => {
    const { container } = render(
      <DataTableBlock columns={columns} rows={[]} />
    );
    // Headers should still render
    expect(screen.getByText("id")).toBeInTheDocument();
    // No data rows
    const tbody = container.querySelector("tbody");
    expect(tbody?.children).toHaveLength(0);
  });
});
