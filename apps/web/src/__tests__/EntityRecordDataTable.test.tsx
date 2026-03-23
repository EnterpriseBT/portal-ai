import { jest } from "@jest/globals";

// ── Mocks ───────────────────────────────────────────────────────────

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    entityRecords: {
      list: jest.fn().mockReturnValue({
        data: null,
        isLoading: false,
        isError: false,
        error: null,
      }),
    },
  },
}));

jest.unstable_mockModule("../components/EntityRecordCellCode.component", () => ({
  EntityRecordCellCode: ({ value, type }: { value: unknown; type: string }) => (
    <code data-testid="cell-code" data-type={type}>{JSON.stringify(value)}</code>
  ),
}));

const { render, screen } = await import("./test-utils");
const { EntityRecordDataTableUI } = await import(
  "../components/EntityRecordDataTable.component"
);

// ── Tests ───────────────────────────────────────────────────────────

describe("EntityRecordDataTableUI", () => {
  const connectorEntityId = "test-entity-id";

  const columns = [
    { key: "first_name", label: "First Name", type: "string" as const },
    { key: "email", label: "Email", type: "string" as const },
    { key: "active", label: "Active", type: "boolean" as const },
  ];

  const rows = [
    { first_name: "Jane", email: "jane@ex.com", active: true },
    { first_name: "Bob", email: "bob@ex.com", active: false },
  ];

  it("renders column headers from columns prop", () => {
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={rows}
        columns={columns}
        source="cache"
      />
    );
    expect(screen.getByText("First Name")).toBeInTheDocument();
    expect(screen.getByText("Email")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders correct number of rows", () => {
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={rows}
        columns={columns}
        source="cache"
      />
    );
    expect(screen.getByText("Jane")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("jane@ex.com")).toBeInTheDocument();
    expect(screen.getByText("bob@ex.com")).toBeInTheDocument();
  });

  it("renders type-aware cells for booleans", () => {
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={rows}
        columns={columns}
        source="cache"
      />
    );
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("renders empty state when rows is empty", () => {
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={[]}
        columns={[]}
        source="cache"
      />
    );
    expect(screen.getByText("No records found")).toBeInTheDocument();
  });

  it("displays source badge for cache", () => {
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={rows}
        columns={columns}
        source="cache"
      />
    );
    expect(screen.getByText("Cached")).toBeInTheDocument();
  });

  it("displays source badge for live", () => {
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={rows}
        columns={columns}
        source="live"
      />
    );
    expect(screen.getByText("Live")).toBeInTheDocument();
  });

  it("calls onSort when column header is clicked", async () => {
    const onSort = jest.fn();
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={rows}
        columns={columns}
        source="cache"
        onSort={onSort}
      />
    );
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByText("First Name"));
    expect(onSort).toHaveBeenCalledWith("first_name");
  });

  it("renders json column as a <code> element", () => {
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={[{ data: { id: 1 } }]}
        columns={[{ key: "data", label: "Data", type: "json" as const }]}
        source="cache"
      />
    );
    expect(screen.getByTestId("cell-code")).toBeInTheDocument();
    expect(screen.getByTestId("cell-code")).toHaveAttribute("data-type", "json");
  });

  it("renders array column as a <code> element", () => {
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={[{ tags: ["a", "b"] }]}
        columns={[{ key: "tags", label: "Tags", type: "array" as const }]}
        source="cache"
      />
    );
    expect(screen.getByTestId("cell-code")).toBeInTheDocument();
    expect(screen.getByTestId("cell-code")).toHaveAttribute("data-type", "array");
  });

  it("renders reference-array column as a <code> element", () => {
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={[{ refs: ["id-1", "id-2"] }]}
        columns={[{ key: "refs", label: "Refs", type: "reference-array" as const }]}
        source="cache"
      />
    );
    expect(screen.getByTestId("cell-code")).toBeInTheDocument();
    expect(screen.getByTestId("cell-code")).toHaveAttribute("data-type", "reference-array");
  });

  it("calls onRowClick when a row is clicked", async () => {
    const onRowClick = jest.fn();
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={rows}
        columns={columns}
        source="cache"
        onRowClick={onRowClick}
      />
    );
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.click(screen.getByText("Jane"));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  it("renders column type as caption in each header", () => {
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={rows}
        columns={columns}
        source="cache"
      />
    );
    // Each column type should appear as a caption below its label
    const stringCaptions = screen.getAllByText("string");
    expect(stringCaptions.length).toBe(2); // first_name and email are both string
    expect(screen.getByText("boolean")).toBeInTheDocument();
  });

  it("renders correct caption for json column type", () => {
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={[{ data: { id: 1 } }]}
        columns={[{ key: "data", label: "Data", type: "json" as const }]}
        source="cache"
      />
    );
    expect(screen.getByText("json")).toBeInTheDocument();
  });

  it("renders correct caption for reference-array column type", () => {
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={[{ refs: ["id-1"] }]}
        columns={[{ key: "refs", label: "Refs", type: "reference-array" as const }]}
        source="cache"
      />
    );
    expect(screen.getByText("reference-array")).toBeInTheDocument();
  });

  it("renders null values as dash", () => {
    render(
      <EntityRecordDataTableUI
        connectorEntityId={connectorEntityId}
        rows={[{ first_name: null, email: "a@b.com", active: null }]}
        columns={columns}
        source="cache"
      />
    );
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});
