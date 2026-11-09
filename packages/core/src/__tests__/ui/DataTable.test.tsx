import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import {
  DataTable,
  useColumnConfig,
  type DataTableColumn,
  type ColumnConfig,
} from "../../ui/DataTable";
import { expectNoAxeViolations } from "../axe.util";

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
      render(<DataTable label="People" columns={columns} rows={rows} />);
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Email")).toBeInTheDocument();
      expect(screen.getByText("Age")).toBeInTheDocument();
    });

    it("renders row data", () => {
      render(<DataTable label="People" columns={columns} rows={rows} />);
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("bob@ex.com")).toBeInTheDocument();
    });

    it("uses column format function when provided", () => {
      render(<DataTable label="People" columns={columns} rows={rows} />);
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
          label="People"
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
      render(<DataTable label="People" columns={cols} rows={[{ val: "x" }]} />);
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
      render(
        <DataTable
          label="People"
          columns={cols}
          rows={[{ name: "Alice", age: 30 }]}
        />
      );
      expect(screen.getByText("Alice (30)")).toBeInTheDocument();
    });

    it("renders null values as dash when no format", () => {
      render(
        <DataTable
          label="People"
          columns={[{ key: "x", label: "X" }]}
          rows={[{ x: null }]}
        />
      );
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("renders empty message when no rows and no columns", () => {
      render(<DataTable label="People" columns={[]} rows={[]} />);
      expect(screen.getByText("No data")).toBeInTheDocument();
    });

    it("renders custom empty message", () => {
      render(
        <DataTable
          label="People"
          columns={[]}
          rows={[]}
          emptyMessage="Nothing here"
        />
      );
      expect(screen.getByText("Nothing here")).toBeInTheDocument();
    });

    it("renders empty message inside table when columns exist but rows are empty", () => {
      render(
        <DataTable
          label="People"
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
      render(
        <DataTable
          label="People"
          columns={columns}
          rows={rows}
          onSort={onSort}
        />
      );
      fireEvent.click(screen.getByText("Name"));
      expect(onSort).toHaveBeenCalledWith("name");
    });

    it("shows active sort indicator on the sorted column", () => {
      render(
        <DataTable
          label="People"
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
      render(<DataTable label="People" columns={columns} rows={rows} />);
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
      render(
        <DataTable label="People" columns={mixed} rows={[]} onSort={onSort} />
      );
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
          label="People"
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
          label="People"
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
          label="People"
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
      render(<DataTable label="People" columns={columns} rows={rows} />);
      expect(
        screen.queryByLabelText("Configure columns")
      ).not.toBeInTheDocument();
    });
  });

  describe("row and cell click handlers", () => {
    it("onRowClick fires with correct row and index on row click", () => {
      const onRowClick = jest.fn();
      render(
        <DataTable
          label="People"
          columns={columns}
          rows={rows}
          onRowClick={onRowClick}
        />
      );
      fireEvent.click(screen.getByText("Alice"));
      expect(onRowClick).toHaveBeenCalledWith(rows[0], 0);
      fireEvent.click(screen.getByText("Bob"));
      expect(onRowClick).toHaveBeenCalledWith(rows[1], 1);
    });

    it("onCellClick fires with correct value, column, and row on cell click", () => {
      const onCellClick = jest.fn();
      const cols: DataTableColumn[] = [
        { key: "name", label: "Name", sortable: true, onCellClick },
        { key: "email", label: "Email", sortable: true },
        { key: "age", label: "Age", sortable: true, format: (v) => `${v} yrs` },
      ];
      render(<DataTable label="People" columns={cols} rows={rows} />);
      fireEvent.click(screen.getByText("Alice"));
      expect(onCellClick).toHaveBeenCalledWith("Alice", cols[0], rows[0]);
    });

    it("clicking a cell with both handlers set: only onCellClick fires", () => {
      const onRowClick = jest.fn();
      const onCellClick = jest.fn();
      const cols: DataTableColumn[] = [
        { key: "name", label: "Name", sortable: true, onCellClick },
        { key: "email", label: "Email", sortable: true },
        { key: "age", label: "Age", sortable: true, format: (v) => `${v} yrs` },
      ];
      render(
        <DataTable
          label="People"
          columns={cols}
          rows={rows}
          onRowClick={onRowClick}
        />
      );
      fireEvent.click(screen.getByText("Alice"));
      expect(onCellClick).toHaveBeenCalledTimes(1);
      expect(onRowClick).not.toHaveBeenCalled();
    });

    it("clicking a cell without onCellClick still fires onRowClick", () => {
      const onRowClick = jest.fn();
      const onCellClick = jest.fn();
      const cols: DataTableColumn[] = [
        { key: "name", label: "Name", sortable: true, onCellClick },
        { key: "email", label: "Email", sortable: true },
        { key: "age", label: "Age", sortable: true, format: (v) => `${v} yrs` },
      ];
      render(
        <DataTable
          label="People"
          columns={cols}
          rows={rows}
          onRowClick={onRowClick}
        />
      );
      fireEvent.click(screen.getByText("alice@ex.com"));
      expect(onRowClick).toHaveBeenCalledWith(rows[0], 0);
      expect(onCellClick).not.toHaveBeenCalled();
    });
  });

  describe("column caption", () => {
    it("renders caption below label when provided", () => {
      const cols: DataTableColumn[] = [
        { key: "name", label: "Name", caption: "string" },
        { key: "age", label: "Age", caption: "number" },
      ];
      render(<DataTable label="People" columns={cols} rows={[]} />);
      expect(screen.getByText("string")).toBeInTheDocument();
      expect(screen.getByText("number")).toBeInTheDocument();
    });

    it("does not render caption element when caption is not set", () => {
      render(<DataTable label="People" columns={columns} rows={rows} />);
      // None of the fixture columns have captions — no extra text nodes should appear
      const headers = screen.getAllByRole("columnheader");
      headers.forEach((h) => {
        // Each header should contain only its label text
        expect(h.querySelectorAll("p, span + *").length).toBeLessThanOrEqual(1);
      });
    });

    it("caption text is distinct from label text", () => {
      const cols: DataTableColumn[] = [
        { key: "created", label: "Created At", caption: "datetime" },
      ];
      render(
        <DataTable
          label="People"
          columns={cols}
          rows={[{ created: "2024-01-01" }]}
        />
      );
      expect(screen.getByText("Created At")).toBeInTheDocument();
      expect(screen.getByText("datetime")).toBeInTheDocument();
      // They are separate DOM nodes
      expect(screen.getByText("Created At")).not.toBe(
        screen.getByText("datetime")
      );
    });

    it("renders caption alongside sort label", () => {
      const cols: DataTableColumn[] = [
        { key: "name", label: "Name", sortable: true, caption: "string" },
      ];
      const onSort = jest.fn();
      render(
        <DataTable label="People" columns={cols} rows={[]} onSort={onSort} />
      );
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("string")).toBeInTheDocument();
    });
  });

  describe("custom header", () => {
    it("renders custom header content", () => {
      render(
        <DataTable
          label="People"
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
          label="People"
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
      const { container } = render(
        <DataTable label="People" columns={columns} rows={rows} />
      );
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

// ── Accessibility (#794) ────────────────────────────────────────────

describe("DataTable accessibility (#794)", () => {
  const Link = React.forwardRef<HTMLAnchorElement, { href: string }>(
    ({ href, ...rest }, ref) => (
      <a ref={ref} href={href} data-link="custom" {...rest} />
    )
  );
  Link.displayName = "Link";

  it("is named by its label, as a caption", () => {
    render(<DataTable label="People" columns={columns} rows={rows} />);
    expect(screen.getByRole("table", { name: "People" })).toBeInTheDocument();
  });

  it("is named by aria-labelledby", () => {
    render(
      <>
        <h2 id="people-heading">Staff</h2>
        <DataTable
          aria-labelledby="people-heading"
          columns={columns}
          rows={rows}
        />
      </>
    );
    expect(screen.getByRole("table", { name: "Staff" })).toBeInTheDocument();
  });

  it("reports aria-sort on the sorted header only", () => {
    render(
      <DataTable
        label="People"
        columns={columns}
        rows={rows}
        onSort={jest.fn()}
        sortColumn="email"
        sortDirection="desc"
      />
    );
    const headers = screen.getAllByRole("columnheader");
    expect(headers[1]).toHaveAttribute("aria-sort", "descending");
    expect(headers[0]).not.toHaveAttribute("aria-sort");
    expect(headers[2]).not.toHaveAttribute("aria-sort");
  });

  it("renders the row's primary cell as a link to rowHref", () => {
    render(
      <DataTable
        label="People"
        columns={columns}
        rows={rows}
        rowHref={(row) => `/people/${row.name}`}
        linkComponent={Link}
      />
    );
    const link = screen.getByRole("link", { name: "Alice" });
    expect(link).toHaveAttribute("href", "/people/Alice");
    expect(link).toHaveAttribute("data-link", "custom");
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("puts the link in primaryColumn's cell", () => {
    render(
      <DataTable
        label="People"
        columns={columns}
        rows={rows}
        rowHref={(row) => `/people/${row.name}`}
        primaryColumn="email"
      />
    );
    expect(screen.getByRole("link", { name: "alice@ex.com" })).toHaveAttribute(
      "href",
      "/people/Alice"
    );
  });

  it("follows the row link when another cell is clicked", async () => {
    const onLinkClick = jest.fn((e: Event) => e.preventDefault());
    render(
      <DataTable
        label="People"
        columns={columns}
        rows={rows}
        rowHref={(row) => `/people/${row.name}`}
      />
    );
    screen
      .getByRole("link", { name: "Alice" })
      .addEventListener("click", onLinkClick);
    await userEvent.click(screen.getByText("alice@ex.com"));
    expect(onLinkClick).toHaveBeenCalledTimes(1);
  });

  it("doesn't follow the row link when a control in the row is clicked", async () => {
    const onLinkClick = jest.fn((e: Event) => e.preventDefault());
    const onAction = jest.fn();
    const cols: DataTableColumn[] = [
      ...columns,
      {
        key: "actions",
        label: "",
        headerLabel: "Actions",
        render: () => (
          <button type="button" onClick={onAction}>
            Act
          </button>
        ),
      },
    ];
    render(
      <DataTable
        label="People"
        columns={cols}
        rows={rows}
        rowHref={(row) => `/people/${row.name}`}
      />
    );
    screen
      .getByRole("link", { name: "Alice" })
      .addEventListener("click", onLinkClick);
    await userEvent.click(screen.getAllByRole("button", { name: "Act" })[0]);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onLinkClick).not.toHaveBeenCalled();
  });

  it("doesn't call onRowClick for a click on a control in the row", async () => {
    const onRowClick = jest.fn();
    const cols: DataTableColumn[] = [
      {
        key: "name",
        label: "Name",
        render: (v) => <button type="button">{String(v)}</button>,
      },
    ];
    render(
      <DataTable
        label="People"
        columns={cols}
        rows={rows}
        onRowClick={onRowClick}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Alice" }));
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("names a header with no visible label through headerLabel", () => {
    render(
      <DataTable
        label="People"
        columns={[
          ...columns,
          { key: "actions", label: "", headerLabel: "Actions" },
        ]}
        rows={rows}
      />
    );
    expect(
      screen.getByRole("columnheader", { name: "Actions" })
    ).toBeInTheDocument();
  });

  // KB-07 (WCAG 2.5.7): reordering columns needs no drag.
  describe("column reorder without dragging", () => {
    const config: ColumnConfig[] = [
      { key: "name", visible: true },
      { key: "email", visible: true },
      { key: "age", visible: true },
    ];
    const openMenu = async (onChange = jest.fn()) => {
      render(
        <DataTable
          label="People"
          columns={columns}
          rows={rows}
          columnConfig={config}
          onColumnConfigChange={onChange}
        />
      );
      await userEvent.click(
        screen.getByRole("button", { name: /configure columns/i })
      );
      return onChange;
    };

    it("moves a column up and down with buttons", async () => {
      const onChange = await openMenu();
      await userEvent.click(
        screen.getByRole("button", { name: "Move Email up" })
      );
      expect(onChange).toHaveBeenLastCalledWith([
        { key: "email", visible: true },
        { key: "name", visible: true },
        { key: "age", visible: true },
      ]);
      await userEvent.click(
        screen.getByRole("button", { name: "Move Email down" })
      );
      expect(onChange).toHaveBeenLastCalledWith([
        { key: "name", visible: true },
        { key: "age", visible: true },
        { key: "email", visible: true },
      ]);
    });

    it("can't move the first column up or the last down, and says why", async () => {
      const onChange = await openMenu();
      const firstUp = screen.getByRole("button", { name: "Move Name up" });
      const lastDown = screen.getByRole("button", { name: "Move Age down" });
      expect(firstUp).toHaveAttribute("aria-disabled", "true");
      expect(firstUp).toHaveAccessibleDescription("Already first");
      expect(lastDown).toHaveAttribute("aria-disabled", "true");
      expect(lastDown).toHaveAccessibleDescription("Already last");
      await userEvent.click(firstUp);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("keeps the drag handle for pointer users", async () => {
      await openMenu();
      expect(
        screen.getByLabelText("Drag to reorder Email")
      ).toBeInTheDocument();
    });
  });

  it("has no axe violations with sort and row links", async () => {
    const { container } = render(
      <DataTable
        label="People"
        columns={columns}
        rows={rows}
        onSort={jest.fn()}
        sortColumn="name"
        sortDirection="asc"
        rowHref={(row) => `/people/${row.name}`}
      />
    );
    await expectNoAxeViolations(container);
  });
});
