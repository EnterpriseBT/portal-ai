import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { jest } from "@jest/globals";
import {
  DataTable,
  useColumnConfig,
  type DataTableColumn,
  type ColumnConfig,
} from "../../ui/DataTable";

// ── Fixtures ────────────────────────────────────────────────────────

const columns: DataTableColumn[] = [
  { key: "name", label: "Name", sortable: true },
  { key: "email", label: "Email", sortable: true },
  { key: "age", label: "Age", sortable: true, format: (v) => `${v} yrs` },
];

const rows = [
  { name: "Alice", email: "alice@ex.com", age: 30 },
  { name: "Bob", email: "bob@ex.com", age: 25 },
];

// ── Helper to test useColumnConfig ──────────────────────────────────

function ConfigHarness({
  columns: cols,
  initialValue,
  onPersist,
}: {
  columns: DataTableColumn[];
  initialValue?: ColumnConfig[];
  onPersist?: (config: ColumnConfig[]) => void;
}) {
  const [config, setConfig] = useColumnConfig(cols, {
    initialValue,
    onPersist,
  });
  return (
    <div>
      <div data-testid="config">{JSON.stringify(config)}</div>
      <button
        onClick={() =>
          setConfig(
            config.map((c) =>
              c.key === "email" ? { ...c, visible: false } : c
            )
          )
        }
      >
        hide-email
      </button>
    </div>
  );
}

// ── Tests ───────────────────────────────────────────────────────────

describe("DataTable", () => {
  describe("rendering", () => {
    it("renders column headers", () => {
      render(<DataTable columns={columns} rows={rows} />);
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Email")).toBeInTheDocument();
      expect(screen.getByText("Age")).toBeInTheDocument();
    });

    it("renders row data", () => {
      render(<DataTable columns={columns} rows={rows} />);
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("bob@ex.com")).toBeInTheDocument();
    });

    it("uses column format function when provided", () => {
      render(<DataTable columns={columns} rows={rows} />);
      expect(screen.getByText("30 yrs")).toBeInTheDocument();
      expect(screen.getByText("25 yrs")).toBeInTheDocument();
    });

    it("uses column render function when provided", () => {
      const cols: DataTableColumn[] = [
        {
          key: "status",
          label: "Status",
          render: (value) => (
            <span data-testid="custom-cell">{value ? "ON" : "OFF"}</span>
          ),
        },
      ];
      render(
        <DataTable
          columns={cols}
          rows={[{ status: true }, { status: false }]}
        />
      );
      const cells = screen.getAllByTestId("custom-cell");
      expect(cells).toHaveLength(2);
      expect(cells[0]).toHaveTextContent("ON");
      expect(cells[1]).toHaveTextContent("OFF");
    });

    it("render takes precedence over format", () => {
      const cols: DataTableColumn[] = [
        {
          key: "val",
          label: "Val",
          format: () => "formatted",
          render: () => <span data-testid="rendered">rendered</span>,
        },
      ];
      render(<DataTable columns={cols} rows={[{ val: "x" }]} />);
      expect(screen.getByTestId("rendered")).toHaveTextContent("rendered");
      expect(screen.queryByText("formatted")).not.toBeInTheDocument();
    });

    it("render receives the full row as second argument", () => {
      const cols: DataTableColumn[] = [
        {
          key: "name",
          label: "Name",
          render: (value, row) => <span>{`${value} (${row.age})`}</span>,
        },
      ];
      render(<DataTable columns={cols} rows={[{ name: "Alice", age: 30 }]} />);
      expect(screen.getByText("Alice (30)")).toBeInTheDocument();
    });

    it("renders null values as dash when no format", () => {
      render(
        <DataTable columns={[{ key: "x", label: "X" }]} rows={[{ x: null }]} />
      );
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("renders empty message when no rows and no columns", () => {
      render(<DataTable columns={[]} rows={[]} />);
      expect(screen.getByText("No data")).toBeInTheDocument();
    });

    it("renders custom empty message", () => {
      render(<DataTable columns={[]} rows={[]} emptyMessage="Nothing here" />);
      expect(screen.getByText("Nothing here")).toBeInTheDocument();
    });

    it("renders empty message inside table when columns exist but rows are empty", () => {
      render(
        <DataTable
          columns={columns}
          rows={[]}
          emptyMessage="No records found"
        />
      );
      // Column headers should still render
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Email")).toBeInTheDocument();
      expect(screen.getByText("Age")).toBeInTheDocument();
      // Empty message should appear in a table cell
      expect(screen.getByText("No records found")).toBeInTheDocument();
    });
  });

  describe("sorting", () => {
    it("calls onSort with column key when header clicked", () => {
      const onSort = jest.fn();
      render(<DataTable columns={columns} rows={rows} onSort={onSort} />);
      fireEvent.click(screen.getByText("Name"));
      expect(onSort).toHaveBeenCalledWith("name");
    });

    it("shows active sort indicator on the sorted column", () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          onSort={jest.fn()}
          sortColumn="name"
          sortDirection="asc"
        />
      );
      // The active TableSortLabel wraps the text in a span with Mui-active class
      const sortLabel = screen.getByText("Name").closest("span");
      expect(sortLabel?.className).toContain("Mui-active");
    });

    it("does not render sort labels when onSort is not provided", () => {
      render(<DataTable columns={columns} rows={rows} />);
      // No aria-sort on any header
      const headers = screen.getAllByRole("columnheader");
      headers.forEach((h) => {
        expect(h).not.toHaveAttribute("aria-sort");
      });
    });

    it("does not render sort label for non-sortable columns", () => {
      const mixed: DataTableColumn[] = [
        { key: "name", label: "Name", sortable: true },
        { key: "notes", label: "Notes", sortable: false },
      ];
      const onSort = jest.fn();
      render(<DataTable columns={mixed} rows={[]} onSort={onSort} />);
      // Sortable column gets a button
      fireEvent.click(screen.getByText("Name"));
      expect(onSort).toHaveBeenCalledWith("name");
      // Non-sortable column is plain text — clicking it does nothing
      onSort.mockClear();
      fireEvent.click(screen.getByText("Notes"));
      expect(onSort).not.toHaveBeenCalled();
    });
  });

  describe("column configuration", () => {
    it("hides columns marked as not visible", () => {
      const config: ColumnConfig[] = [
        { key: "name", visible: true },
        { key: "email", visible: false },
        { key: "age", visible: true },
      ];
      render(
        <DataTable
          columns={columns}
          rows={rows}
          columnConfig={config}
          onColumnConfigChange={jest.fn()}
        />
      );
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.queryByText("Email")).not.toBeInTheDocument();
      expect(screen.getByText("Age")).toBeInTheDocument();
      // Cell data also hidden
      expect(screen.queryByText("alice@ex.com")).not.toBeInTheDocument();
    });

    it("respects column order from config", () => {
      const config: ColumnConfig[] = [
        { key: "age", visible: true },
        { key: "name", visible: true },
        { key: "email", visible: false },
      ];
      render(
        <DataTable
          columns={columns}
          rows={rows}
          columnConfig={config}
          onColumnConfigChange={jest.fn()}
        />
      );
      const headers = screen.getAllByRole("columnheader");
      expect(headers[0]).toHaveTextContent("Age");
      expect(headers[1]).toHaveTextContent("Name");
    });

    it("shows configure columns button when config is provided", () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          columnConfig={[
            { key: "name", visible: true },
            { key: "email", visible: true },
            { key: "age", visible: true },
          ]}
          onColumnConfigChange={jest.fn()}
        />
      );
      expect(screen.getByLabelText("Configure columns")).toBeInTheDocument();
    });

    it("does not show configure button when config is not provided", () => {
      render(<DataTable columns={columns} rows={rows} />);
      expect(
        screen.queryByLabelText("Configure columns")
      ).not.toBeInTheDocument();
    });
  });

  describe("custom header", () => {
    it("renders custom header content", () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          header={<span data-testid="custom-header">My Header</span>}
        />
      );
      expect(screen.getByTestId("custom-header")).toBeInTheDocument();
      expect(screen.getByText("My Header")).toBeInTheDocument();
    });

    it("renders header alongside column config menu", () => {
      render(
        <DataTable
          columns={columns}
          rows={rows}
          header={<span>Header Text</span>}
          columnConfig={[
            { key: "name", visible: true },
            { key: "email", visible: true },
            { key: "age", visible: true },
          ]}
          onColumnConfigChange={jest.fn()}
        />
      );
      expect(screen.getByText("Header Text")).toBeInTheDocument();
      expect(screen.getByLabelText("Configure columns")).toBeInTheDocument();
    });

    it("does not render header bar when header is not provided and no config", () => {
      const { container } = render(<DataTable columns={columns} rows={rows} />);
      // The table should be the first child — no header bar above it
      const firstChild = container.firstElementChild?.firstElementChild;
      expect(firstChild?.tagName).toBe("DIV"); // TableContainer wraps a div
    });
  });
});

describe("useColumnConfig", () => {
  it("initialises all columns as visible", () => {
    render(<ConfigHarness columns={columns} />);
    const config = JSON.parse(screen.getByTestId("config").textContent!);
    expect(config).toEqual([
      { key: "name", visible: true },
      { key: "email", visible: true },
      { key: "age", visible: true },
    ]);
  });

  it("allows toggling visibility", () => {
    render(<ConfigHarness columns={columns} />);
    fireEvent.click(screen.getByText("hide-email"));
    const config = JSON.parse(screen.getByTestId("config").textContent!);
    const email = config.find((c: ColumnConfig) => c.key === "email");
    expect(email.visible).toBe(false);
  });

  it("uses initialValue when provided", () => {
    const initial: ColumnConfig[] = [
      { key: "age", visible: true },
      { key: "name", visible: false },
      { key: "email", visible: true },
    ];
    render(<ConfigHarness columns={columns} initialValue={initial} />);
    const config = JSON.parse(screen.getByTestId("config").textContent!);
    expect(config).toEqual(initial);
  });

  it("calls onPersist when config changes", () => {
    const onPersist = jest.fn();
    render(<ConfigHarness columns={columns} onPersist={onPersist} />);
    fireEvent.click(screen.getByText("hide-email"));
    expect(onPersist).toHaveBeenCalledTimes(1);
    expect(onPersist).toHaveBeenCalledWith([
      { key: "name", visible: true },
      { key: "email", visible: false },
      { key: "age", visible: true },
    ]);
  });

  it("does not call onPersist when not provided", () => {
    render(<ConfigHarness columns={columns} />);
    // Should not throw when toggling without onPersist
    fireEvent.click(screen.getByText("hide-email"));
    const config = JSON.parse(screen.getByTestId("config").textContent!);
    const email = config.find((c: ColumnConfig) => c.key === "email");
    expect(email.visible).toBe(false);
  });
});
