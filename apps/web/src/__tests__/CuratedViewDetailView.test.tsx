import { jest } from "@jest/globals";

// The pure UI does no fetching; the module also exports the container which
// imports the SDK + dialogs (which import the SDK) — stub it.
jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    curatedViews: {
      get: jest.fn(),
      records: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    fieldMappings: { list: jest.fn() },
    entityRecords: { list: jest.fn() },
    connectorEntities: { list: jest.fn() },
  },
  queryKeys: { curatedViews: { root: ["curatedViews"] } },
}));

const { render, screen, fireEvent } = await import("./test-utils");
const { CuratedViewDetailUI } = await import("../views/CuratedViewDetail.view");

const view = {
  id: "cv-1",
  organizationId: "org-1",
  connectorEntityId: "ent-1",
  key: "ne_accounts",
  label: "NE Accounts",
  description: "North-east accounts",
  filter: null,
  fieldMappingIds: ["fm-1"],
  filtered: false,
  capabilities: { read: true, write: true, delete: true, share: true },
  projected: true,
  created: Date.now(),
  createdBy: "u1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

// #678: the records endpoint returns ResolvedColumns (the entity table's
// shape) keyed by normalizedKey. `name` and `alias` share one column
// definition ("Name"); `tags` is json (unsortable).
const col = (
  normalizedKey: string,
  key: string,
  label: string,
  type: "string" | "json"
) => ({
  key,
  normalizedKey,
  label,
  type,
  required: false,
  enumValues: null,
  defaultValue: null,
  format: null,
  validationPattern: null,
  canonicalFormat: null,
});
const columns = [
  col("name", "name", "Name", "string"),
  col("region", "region", "Region", "string"),
  col("tags", "tags", "Tags", "json"),
  col("alias", "name", "Name", "string"),
];

const records = [
  {
    _record_id: "r1",
    _source_id: "s1",
    name: "Acme",
    region: "NE",
    tags: ["a"],
    alias: "ACME Co",
  },
  {
    _record_id: "r2",
    _source_id: "s2",
    name: "Globex",
    region: "NE",
    tags: [],
    alias: "Globex Corp",
  },
];

const baseProps = {
  view,
  columns,
  records,
  recordsLoading: false,
  recordsError: false,
  paginationToolbar: <div data-testid="pagination-toolbar" />,
  sortColumn: "name",
  sortDirection: "asc" as const,
  onSort: jest.fn(),
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  onNavigate: jest.fn(),
};

describe("CuratedViewDetailUI", () => {
  it("renders the records table with data columns (excluding internal keys)", () => {
    render(<CuratedViewDetailUI {...baseProps} />);
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Globex")).toBeInTheDocument();
    // Internal identifier keys are not rendered as columns.
    expect(screen.queryByText("_record_id")).not.toBeInTheDocument();
    expect(screen.queryByText("_source_id")).not.toBeInTheDocument();
  });

  it("#678: headers are field-mapping keys with a label · type caption, distinct for a shared definition", () => {
    render(<CuratedViewDetailUI {...baseProps} />);
    for (const h of ["name", "region", "tags", "alias"]) {
      expect(screen.getByText(h)).toBeInTheDocument();
    }
    // `alias` shares the "Name" definition, so it gets a caption naming it.
    expect(screen.getByText("Name · string")).toBeInTheDocument();
    expect(screen.queryByText("c_name")).not.toBeInTheDocument();
  });

  it("#678: a json column isn't sortable; a string column is", () => {
    const onSort = jest.fn();
    render(<CuratedViewDetailUI {...baseProps} onSort={onSort} />);
    fireEvent.click(screen.getByText("tags"));
    expect(onSort).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("region"));
    expect(onSort).toHaveBeenCalledWith("region");
  });

  it("#678: the column picker lists exactly the view's columns (no validity column)", async () => {
    render(<CuratedViewDetailUI {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Configure columns" }));
    const handles = await screen.findAllByLabelText(/^Drag to reorder /);
    expect(
      handles
        .map((h) =>
          h.getAttribute("aria-label")!.replace("Drag to reorder ", "")
        )
        .sort()
    ).toEqual(["alias", "name", "region", "tags"]);
    expect(screen.queryByText("Valid")).not.toBeInTheDocument();
    expect(screen.queryByText("Cached")).not.toBeInTheDocument();
  });

  it("#678: a saved hidden column stays hidden when the columns arrive after the first render", () => {
    // The container's columns come with the first records response, so the
    // page first renders loading with no columns. That render must not reset
    // the saved column config.
    const key = "column-config:curated-view:cv-1";
    const saved = [
      { key: "name", visible: true },
      { key: "region", visible: false },
      { key: "tags", visible: true },
      { key: "alias", visible: true },
    ];
    localStorage.setItem(key, JSON.stringify(saved));
    const { rerender } = render(
      <CuratedViewDetailUI
        {...baseProps}
        columns={[]}
        records={[]}
        recordsLoading
      />
    );
    rerender(<CuratedViewDetailUI {...baseProps} />);

    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.queryByText("region")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(key) ?? "[]")).toEqual(saved);
    localStorage.removeItem(key);
  });

  it("#678: the Row filter metadata still reads Filtered / All rows", () => {
    const { unmount } = render(<CuratedViewDetailUI {...baseProps} />);
    expect(screen.getByText("All rows")).toBeInTheDocument();
    unmount();
    // #680: a reader without write gets filter: null and filtered: true.
    render(
      <CuratedViewDetailUI
        {...baseProps}
        view={{ ...view, filter: null, filtered: true }}
      />
    );
    expect(screen.getByText("Filtered")).toBeInTheDocument();
  });

  it("#680: Columns reads `projected`: the reader's count, never 'All columns' for a projected view", () => {
    const { unmount } = render(
      <CuratedViewDetailUI
        {...baseProps}
        view={{ ...view, projected: true, fieldMappingIds: ["fm-1", "fm-2"] }}
      />
    );
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    unmount();
    // A projected view whose columns the reader can't read any of.
    const second = render(
      <CuratedViewDetailUI
        {...baseProps}
        view={{ ...view, projected: true, fieldMappingIds: [] }}
      />
    );
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    expect(screen.queryByText("All columns")).not.toBeInTheDocument();
    second.unmount();
    render(
      <CuratedViewDetailUI
        {...baseProps}
        view={{ ...view, projected: false, fieldMappingIds: [] }}
      />
    );
    expect(screen.getByText("All columns")).toBeInTheDocument();
  });

  it("#688: shows Edit and Delete with write and delete", () => {
    render(<CuratedViewDetailUI {...baseProps} />);
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("#688: a read-only view shows neither Edit nor Delete, so the editor is unreachable", () => {
    render(
      <CuratedViewDetailUI
        {...baseProps}
        view={{
          ...view,
          capabilities: {
            read: true,
            write: false,
            delete: false,
            share: false,
          },
        }}
      />
    );
    expect(
      screen.queryByRole("button", { name: /edit/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete/i })
    ).not.toBeInTheDocument();
  });

  it("#688: write without delete shows Edit only", () => {
    render(
      <CuratedViewDetailUI
        {...baseProps}
        view={{
          ...view,
          capabilities: {
            read: true,
            write: true,
            delete: false,
            share: false,
          },
        }}
      />
    );
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete/i })
    ).not.toBeInTheDocument();
  });

  it("renders an empty state when there are no rows", () => {
    render(<CuratedViewDetailUI {...baseProps} records={[]} />);
    expect(screen.getByText("No rows")).toBeInTheDocument();
  });
});
