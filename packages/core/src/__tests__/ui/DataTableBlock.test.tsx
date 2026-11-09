import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";

import userEvent from "@testing-library/user-event";

import { DataTableBlock } from "../../ui/DataTableBlock";
import { expectNoAxeViolations } from "../axe.util";

describe("DataTableBlock", () => {
  const columns = ["id", "name", "revenue"];
  const rows = [
    { id: 1, name: "Alice", revenue: 100 },
    { id: 2, name: "Bob", revenue: 200 },
    { id: 3, name: "Charlie", revenue: 50 },
  ];

  it("renders column headers", () => {
    render(
      <DataTableBlock label="Query results" columns={columns} rows={rows} />
    );
    for (const col of columns) {
      expect(screen.getByText(col)).toBeInTheDocument();
    }
  });

  it("renders row data", () => {
    render(
      <DataTableBlock label="Query results" columns={columns} rows={rows} />
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
  });

  it("renders null values as empty string", () => {
    const rowsWithNull = [{ id: 1, name: null, revenue: undefined }];
    render(
      <DataTableBlock
        label="Query results"
        columns={columns}
        rows={rowsWithNull as unknown as Record<string, unknown>[]}
      />
    );
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("shows pagination when rows exceed smallest page size option", () => {
    const manyRows = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      name: `Row ${i}`,
    }));
    render(
      <DataTableBlock
        label="Query results"
        columns={["id", "name"]}
        rows={manyRows}
      />
    );

    expect(screen.getByTestId("table-pagination")).toBeInTheDocument();
  });

  it("navigates to next page", () => {
    const manyRows = Array.from({ length: 75 }, (_, i) => ({
      id: i,
      name: `Row ${i}`,
    }));
    render(
      <DataTableBlock
        label="Query results"
        columns={["id", "name"]}
        rows={manyRows}
      />
    );

    const nextButton = screen.getByLabelText("Go to next page");
    fireEvent.click(nextButton);

    expect(screen.getByText("Row 10")).toBeInTheDocument();
    expect(screen.getByText("Row 19")).toBeInTheDocument();
    expect(screen.queryByText("Row 0")).not.toBeInTheDocument();
  });

  it("does not show pagination when under smallest page size option", () => {
    render(
      <DataTableBlock label="Query results" columns={columns} rows={rows} />
    );
    expect(screen.queryByTestId("table-pagination")).not.toBeInTheDocument();
  });

  it("hides search bar when rows are empty", () => {
    render(
      <DataTableBlock label="Query results" columns={columns} rows={[]} />
    );
    expect(screen.queryByTestId("table-search")).not.toBeVisible();
  });

  it("renders empty table when no rows", () => {
    const { container } = render(
      <DataTableBlock label="Query results" columns={columns} rows={[]} />
    );
    expect(screen.getByText("id")).toBeInTheDocument();
    const tbody = container.querySelector("tbody");
    expect(tbody?.children).toHaveLength(0);
  });

  // ── Sorting ──────────────────────────────────────────────────────────

  it("sorts numeric column ascending then descending on header click", () => {
    const { container } = render(
      <DataTableBlock label="Query results" columns={columns} rows={rows} />
    );

    fireEvent.click(screen.getByText("revenue"));

    const tbody = container.querySelector("tbody")!;
    const cellsAfterAsc = within(tbody)
      .getAllByRole("row")
      .map((r) => within(r).getAllByRole("cell")[2].textContent);
    expect(cellsAfterAsc).toEqual(["50", "100", "200"]);

    fireEvent.click(screen.getByText("revenue"));

    const cellsAfterDesc = within(tbody)
      .getAllByRole("row")
      .map((r) => within(r).getAllByRole("cell")[2].textContent);
    expect(cellsAfterDesc).toEqual(["200", "100", "50"]);
  });

  it("sorts string column alphabetically", () => {
    const { container } = render(
      <DataTableBlock label="Query results" columns={columns} rows={rows} />
    );

    fireEvent.click(screen.getByText("name"));

    const tbody = container.querySelector("tbody")!;
    const names = within(tbody)
      .getAllByRole("row")
      .map((r) => within(r).getAllByRole("cell")[1].textContent);
    expect(names).toEqual(["Alice", "Bob", "Charlie"]);
  });

  // ── Search ───────────────────────────────────────────────────────────

  it("renders a search input", () => {
    render(
      <DataTableBlock label="Query results" columns={columns} rows={rows} />
    );
    expect(screen.getByTestId("table-search")).toBeInTheDocument();
  });

  it("filters rows by search term", () => {
    render(
      <DataTableBlock label="Query results" columns={columns} rows={rows} />
    );

    const input = screen.getByTestId("table-search").querySelector("input")!;
    fireEvent.change(input, { target: { value: "ali" } });

    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Bob")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
  });

  it("filters by numeric value via coercion", () => {
    render(
      <DataTableBlock label="Query results" columns={columns} rows={rows} />
    );

    const input = screen.getByTestId("table-search").querySelector("input")!;
    fireEvent.change(input, { target: { value: "200" } });

    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("resets page to 0 when searching", () => {
    const manyRows = Array.from({ length: 75 }, (_, i) => ({
      id: i,
      name: `Row ${i}`,
    }));
    render(
      <DataTableBlock
        label="Query results"
        columns={["id", "name"]}
        rows={manyRows}
      />
    );

    // Go to page 2
    fireEvent.click(screen.getByLabelText("Go to next page"));
    expect(screen.queryByText("Row 0")).not.toBeInTheDocument();

    // Search resets to page 0
    const input = screen.getByTestId("table-search").querySelector("input")!;
    fireEvent.change(input, { target: { value: "Row 1" } });

    expect(screen.getByText("Row 1")).toBeInTheDocument();
  });
});

// #794: a named table with a named search and sort state.
describe("DataTableBlock accessibility (#794)", () => {
  const cols = ["name", "age"];
  const data = [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 },
  ];

  it("is named by its label, and so is its search", () => {
    render(<DataTableBlock label="Query results" columns={cols} rows={data} />);
    expect(
      screen.getByRole("table", { name: "Query results" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Search Query results" })
    ).toBeInTheDocument();
  });

  it("reports aria-sort on the sorted header", async () => {
    render(<DataTableBlock label="Query results" columns={cols} rows={data} />);
    await userEvent.click(screen.getByRole("button", { name: "age" }));
    expect(screen.getAllByRole("columnheader")[1]).toHaveAttribute(
      "aria-sort",
      "ascending"
    );
    expect(screen.getAllByRole("columnheader")[0]).not.toHaveAttribute(
      "aria-sort"
    );
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <DataTableBlock label="Query results" columns={cols} rows={data} />
    );
    await expectNoAxeViolations(container);
  });
});
