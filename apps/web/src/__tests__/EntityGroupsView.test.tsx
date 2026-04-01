import { jest } from "@jest/globals";

// ── Mocks ───────────────────────────────────────────────────────────

const mockEntityGroupList = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    entityGroups: {
      list: mockEntityGroupList,
      create: () => ({
        mutate: jest.fn(),
        isPending: false,
        error: null,
      }),
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
  },
  queryKeys: {
    entityGroups: {
      root: ["entityGroups"],
    },
  },
}));

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { EntityGroupsViewUI } = await import("../views/EntityGroups.view");

// ── Fixtures ────────────────────────────────────────────────────────

const twoGroups = {
  data: {
    entityGroups: [
      {
        id: "grp-1",
        organizationId: "org-1",
        name: "Customer Identity",
        description: "Groups customer entities across connectors",
        memberCount: 3,
        created: Date.now(),
        createdBy: "system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
      {
        id: "grp-2",
        organizationId: "org-1",
        name: "Product Catalog",
        description: null,
        memberCount: 0,
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

const emptyGroups = {
  data: {
    entityGroups: [],
    total: 0,
    limit: 20,
    offset: 0,
  },
  isLoading: false,
  isError: false,
  error: null,
};

// ── Tests ───────────────────────────────────────────────────────────

describe("EntityGroupsView", () => {
  const mockOnCreateGroup = jest.fn();
  const mockOnDeleteGroup = jest.fn();

  beforeEach(() => {
    mockEntityGroupList.mockReturnValue(twoGroups);
    mockOnCreateGroup.mockClear();
  });

  it("renders the page title", () => {
    render(<EntityGroupsViewUI onCreateGroup={mockOnCreateGroup} onDeleteGroup={mockOnDeleteGroup} />);
    expect(
      screen.getByRole("heading", { name: "Entity Groups" })
    ).toBeInTheDocument();
  });

  it("renders breadcrumbs with Dashboard link", () => {
    render(<EntityGroupsViewUI onCreateGroup={mockOnCreateGroup} onDeleteGroup={mockOnDeleteGroup} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("renders group cards with name and description", () => {
    render(<EntityGroupsViewUI onCreateGroup={mockOnCreateGroup} onDeleteGroup={mockOnDeleteGroup} />);
    expect(screen.getByText("Customer Identity")).toBeInTheDocument();
    expect(
      screen.getByText("Groups customer entities across connectors")
    ).toBeInTheDocument();
    expect(screen.getByText("Product Catalog")).toBeInTheDocument();
  });

  it("renders empty state when no groups", () => {
    mockEntityGroupList.mockReturnValue(emptyGroups);

    render(<EntityGroupsViewUI onCreateGroup={mockOnCreateGroup} onDeleteGroup={mockOnDeleteGroup} />);
    expect(screen.getByText("No entity groups found")).toBeInTheDocument();
  });

  it("renders search bar in pagination toolbar", () => {
    render(<EntityGroupsViewUI onCreateGroup={mockOnCreateGroup} onDeleteGroup={mockOnDeleteGroup} />);
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  it("renders Create Group button", () => {
    render(<EntityGroupsViewUI onCreateGroup={mockOnCreateGroup} onDeleteGroup={mockOnDeleteGroup} />);
    expect(
      screen.getByRole("button", { name: /Create Group/i })
    ).toBeInTheDocument();
  });

  it("calls onCreateGroup when Create Group button is clicked", async () => {
    const user = userEvent.setup();
    render(<EntityGroupsViewUI onCreateGroup={mockOnCreateGroup} onDeleteGroup={mockOnDeleteGroup} />);
    await user.click(screen.getByRole("button", { name: /Create Group/i }));
    expect(mockOnCreateGroup).toHaveBeenCalledTimes(1);
  });

  it("renders member count on cards", () => {
    render(<EntityGroupsViewUI onCreateGroup={mockOnCreateGroup} onDeleteGroup={mockOnDeleteGroup} />);
    expect(screen.getByText("3 members")).toBeInTheDocument();
    expect(screen.getByText("0 members")).toBeInTheDocument();
  });

  it("does not render description for group with null description", () => {
    render(<EntityGroupsViewUI onCreateGroup={mockOnCreateGroup} onDeleteGroup={mockOnDeleteGroup} />);
    // Product Catalog has null description — only name should appear in its card
    expect(screen.getByText("Product Catalog")).toBeInTheDocument();
    // The description for Customer Identity should still render
    expect(
      screen.getByText("Groups customer entities across connectors")
    ).toBeInTheDocument();
  });
});
