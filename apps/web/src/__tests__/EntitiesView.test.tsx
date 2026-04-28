import { jest } from "@jest/globals";

// ── Mocks ───────────────────────────────────────────────────────────

const mockEntityList = jest.fn();
const mockSearchConnectorInstances = jest.fn(() => Promise.resolve([]));
const mockSearchTags = jest.fn(() => Promise.resolve([]));

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    connectorEntities: {
      list: mockEntityList,
      delete: () => ({
        mutate: jest.fn(),
        isPending: false,
        error: null,
      }),
      impact: () => ({
        data: null,
        isLoading: false,
      }),
    },
    entityTags: {
      search: () => ({
        onSearch: mockSearchTags,
        labelMap: {},
      }),
    },
    connectorInstances: {
      search: () => ({
        onSearch: mockSearchConnectorInstances,
        labelMap: {},
      }),
    },
  },
  queryKeys: {
    connectorEntities: {
      root: ["connectorEntities"],
    },
  },
}));

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
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
  const mockOnDeleteEntity = jest.fn();

  const sharedProps = {
    onDeleteEntity: mockOnDeleteEntity,
    onCreate: jest.fn(),
  };

  beforeEach(() => {
    mockEntityList.mockReturnValue(twoEntities);
  });

  it("renders the page title", () => {
    render(<EntitiesViewUI {...sharedProps} />);
    expect(
      screen.getByRole("heading", { name: "Entities" })
    ).toBeInTheDocument();
  });

  it("renders breadcrumbs with Dashboard link", () => {
    render(<EntitiesViewUI {...sharedProps} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("renders entity cards from the data", () => {
    render(<EntitiesViewUI {...sharedProps} />);
    expect(screen.getByText("Contacts")).toBeInTheDocument();
    expect(screen.getByText("Deals")).toBeInTheDocument();
  });

  it("renders connector instance name on entity cards", () => {
    render(<EntitiesViewUI {...sharedProps} />);
    const names = screen.getAllByText("My CSV");
    expect(names.length).toBe(2);
  });

  it("renders entity key chips", () => {
    render(<EntitiesViewUI {...sharedProps} />);
    expect(screen.getByText("contacts")).toBeInTheDocument();
    expect(screen.getByText("deals")).toBeInTheDocument();
  });

  it("renders empty state when no entities", () => {
    mockEntityList.mockReturnValue(emptyEntities);

    render(<EntitiesViewUI {...sharedProps} />);
    expect(screen.getByText("No entities found")).toBeInTheDocument();
  });

  it("renders pagination toolbar", () => {
    render(<EntitiesViewUI {...sharedProps} />);
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  it("renders filter button with tag filter available", async () => {
    const user = userEvent.setup();
    render(<EntitiesViewUI {...sharedProps} />);
    await user.click(screen.getByText("Filter"));
    expect(screen.getByText("Tags")).toBeInTheDocument();
  });

  describe("write capability gating", () => {
    it("hides delete action when enabledCapabilityFlags.write is false", () => {
      mockEntityList.mockReturnValue({
        ...twoEntities,
        data: {
          ...twoEntities.data,
          connectorEntities: twoEntities.data.connectorEntities.map((e) => ({
            ...e,
            connectorInstance: {
              ...e.connectorInstance,
              enabledCapabilityFlags: { write: false },
            },
          })),
        },
      });
      render(<EntitiesViewUI {...sharedProps} />);
      expect(
        screen.queryByRole("button", { name: "Delete" })
      ).not.toBeInTheDocument();
    });

    it("shows delete action when enabledCapabilityFlags.write is true", () => {
      mockEntityList.mockReturnValue({
        ...twoEntities,
        data: {
          ...twoEntities.data,
          connectorEntities: twoEntities.data.connectorEntities.map((e) => ({
            ...e,
            connectorInstance: {
              ...e.connectorInstance,
              enabledCapabilityFlags: { write: true },
            },
          })),
        },
      });
      render(<EntitiesViewUI {...sharedProps} />);
      expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
    });

    it("hides delete action when enabledCapabilityFlags is null", () => {
      mockEntityList.mockReturnValue({
        ...twoEntities,
        data: {
          ...twoEntities.data,
          connectorEntities: twoEntities.data.connectorEntities.map((e) => ({
            ...e,
            connectorInstance: {
              ...e.connectorInstance,
              enabledCapabilityFlags: null,
            },
          })),
        },
      });
      render(<EntitiesViewUI {...sharedProps} />);
      expect(
        screen.queryByRole("button", { name: "Delete" })
      ).not.toBeInTheDocument();
    });
  });
});
