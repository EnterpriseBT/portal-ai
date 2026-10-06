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
        capabilities: { read: true, write: true, delete: true },
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
        capabilities: { read: true, write: true, delete: true },
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
    createGate: { kind: "allow" } as const,
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

  // #689: Delete follows each row's `capabilities` (the entity delete route
  // doesn't check the connector's write flag); Create takes the page gate.
  describe("permission gating", () => {
    const withCapabilities = (del: boolean, write = false) => ({
      ...twoEntities,
      data: {
        ...twoEntities.data,
        connectorEntities: twoEntities.data.connectorEntities.map((e) => ({
          ...e,
          connectorInstance: {
            ...e.connectorInstance,
            enabledCapabilityFlags: { write },
          },
          capabilities: { read: true, write: del, delete: del },
        })),
      },
    });

    it("shows Delete on rows the caller may delete, even with the connector's writes off", () => {
      mockEntityList.mockReturnValue(withCapabilities(true, false));
      render(<EntitiesViewUI {...sharedProps} />);
      expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
    });

    it("hides Delete on rows the caller can't delete", () => {
      mockEntityList.mockReturnValue(withCapabilities(false, true));
      render(<EntitiesViewUI {...sharedProps} />);
      expect(
        screen.queryByRole("button", { name: "Delete" })
      ).not.toBeInTheDocument();
    });

    it("renders Create from its gate", async () => {
      const onCreate = jest.fn();
      const { unmount } = render(
        <EntitiesViewUI
          {...sharedProps}
          onCreate={onCreate}
          createGate={{ kind: "allow" }}
        />
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Create Entity" })
      );
      expect(onCreate).toHaveBeenCalledTimes(1);
      unmount();

      render(
        <EntitiesViewUI
          {...sharedProps}
          createGate={{
            kind: "disable",
            reason: "Ask for access to create entities",
          }}
        />
      );
      expect(
        screen.getByRole("button", { name: "Create Entity" })
      ).toHaveAttribute("aria-disabled", "true");
    });

    it("hides Create for a hide gate", () => {
      render(<EntitiesViewUI {...sharedProps} createGate={{ kind: "hide" }} />);
      expect(
        screen.queryByRole("button", { name: "Create Entity" })
      ).not.toBeInTheDocument();
    });
  });
});
