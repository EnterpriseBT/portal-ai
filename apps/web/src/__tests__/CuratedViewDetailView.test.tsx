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

const { render, screen } = await import("./test-utils");
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
  created: Date.now(),
  createdBy: "u1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const records = [
  { _record_id: "r1", source_id: "s1", c_name: "Acme", c_region: "NE" },
  { _record_id: "r2", source_id: "s2", c_name: "Globex", c_region: "NE" },
];

const baseProps = {
  view,
  records,
  recordsLoading: false,
  recordsError: false,
  canManage: true,
  onEdit: jest.fn(),
  onDelete: jest.fn(),
  onNavigate: jest.fn(),
};

describe("CuratedViewDetailUI", () => {
  it("renders the records table with data columns (excluding internal keys)", () => {
    render(<CuratedViewDetailUI {...baseProps} />);
    expect(screen.getByText("c_name")).toBeInTheDocument();
    expect(screen.getByText("c_region")).toBeInTheDocument();
    // Internal identifier keys are not rendered as columns.
    expect(screen.queryByText("_record_id")).not.toBeInTheDocument();
    expect(screen.queryByText("source_id")).not.toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Globex")).toBeInTheDocument();
  });

  it("shows Edit/Delete when canManage is true", () => {
    render(<CuratedViewDetailUI {...baseProps} canManage />);
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("hides Edit/Delete when canManage is false", () => {
    render(<CuratedViewDetailUI {...baseProps} canManage={false} />);
    expect(
      screen.queryByRole("button", { name: /edit/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete/i })
    ).not.toBeInTheDocument();
  });

  it("renders an empty state when there are no rows", () => {
    render(<CuratedViewDetailUI {...baseProps} records={[]} />);
    expect(screen.getByText("No rows")).toBeInTheDocument();
  });
});
