import { jest } from "@jest/globals";

// ── Mocks ───────────────────────────────────────────────────────────

const mockEntityList = jest.fn();
const mockInstanceList = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    connectorEntities: {
      list: mockEntityList,
    },
    connectorInstances: {
      list: mockInstanceList,
    },
  },
}));

const { render, screen } = await import("./test-utils");
const { EntitiesViewUI } = await import("../views/Entities.view");

// ── Fixtures ────────────────────────────────────────────────────────

const twoEntities = {
  data: {
    connectorEntities: [
      {
        id: "ent-1",
        connectorInstanceId: "inst-1",
        organizationId: "org-1",
        key: "contacts",
        label: "Contacts",
        connectorInstance: { id: "inst-1", name: "My CSV" },
        created: Date.now(),
        createdBy: "system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
      {
        id: "ent-2",
        connectorInstanceId: "inst-1",
        organizationId: "org-1",
        key: "deals",
        label: "Deals",
        connectorInstance: { id: "inst-1", name: "My CSV" },
        created: Date.now(),
        createdBy: "system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ],
    total: 2,
    limit: 20,
    offset: 0,
  },
  isLoading: false,
  isError: false,
  error: null,
};

const emptyEntities = {
  data: {
    connectorEntities: [],
    total: 0,
    limit: 20,
    offset: 0,
  },
  isLoading: false,
  isError: false,
  error: null,
};

// ── Tests ───────────────────────────────────────────────────────────

describe("EntitiesView", () => {
  beforeEach(() => {
    mockEntityList.mockReturnValue(twoEntities);
    mockInstanceList.mockReturnValue({
      data: { connectorInstances: [], total: 0, limit: 100, offset: 0 },
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  it("renders the page title", () => {
    render(
      <EntitiesViewUI
        connectorInstanceOptions={[{ label: "My CSV", value: "inst-1" }]}
      />
    );
    expect(
      screen.getByRole("heading", { name: "Entities" })
    ).toBeInTheDocument();
  });

  it("renders breadcrumbs with Dashboard link", () => {
    render(<EntitiesViewUI connectorInstanceOptions={[]} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("renders entity cards from the data", () => {
    render(<EntitiesViewUI connectorInstanceOptions={[]} />);
    expect(screen.getByText("Contacts")).toBeInTheDocument();
    expect(screen.getByText("Deals")).toBeInTheDocument();
  });

  it("renders connector instance name on entity cards", () => {
    render(<EntitiesViewUI connectorInstanceOptions={[]} />);
    const names = screen.getAllByText("My CSV");
    expect(names.length).toBe(2);
  });

  it("renders entity key chips", () => {
    render(<EntitiesViewUI connectorInstanceOptions={[]} />);
    expect(screen.getByText("contacts")).toBeInTheDocument();
    expect(screen.getByText("deals")).toBeInTheDocument();
  });

  it("renders empty state when no entities", () => {
    mockEntityList.mockReturnValue(emptyEntities);

    render(<EntitiesViewUI connectorInstanceOptions={[]} />);
    expect(screen.getByText("No entities found")).toBeInTheDocument();
  });

  it("renders pagination toolbar", () => {
    render(<EntitiesViewUI connectorInstanceOptions={[]} />);
    expect(
      screen.getByPlaceholderText("Search...")
    ).toBeInTheDocument();
  });
});
