import { jest } from "@jest/globals";

// The pure UI does no fetching, but the module also exports the container
// which imports the SDK — stub it so the import graph stays light.
jest.unstable_mockModule("../api/sdk", () => ({
  sdk: { curatedViews: { list: jest.fn() } },
  queryKeys: { curatedViews: { root: ["curatedViews"] } },
}));

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { CuratedViewsUI } = await import("../views/CuratedViews.view");

const views = [
  {
    id: "cv-1",
    organizationId: "org-1",
    connectorEntityId: "ent-1",
    key: "ne_accounts",
    label: "NE Accounts",
    description: "North-east accounts",
    filter: null,
    created: Date.now(),
    createdBy: "u1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
  {
    id: "cv-2",
    organizationId: "org-1",
    connectorEntityId: "ent-1",
    key: "sw_accounts",
    label: "SW Accounts",
    description: null,
    filter: { combinator: "and", conditions: [] },
    created: Date.now(),
    createdBy: "u1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
] as unknown as Parameters<typeof CuratedViewsUI>[0]["views"];

function baseProps(canManage: boolean) {
  return {
    views,
    isLoading: false,
    isError: false,
    canManage,
    hasActiveFilters: false,
    paginationToolbar: <div data-testid="pagination-toolbar" />,
    onOpen: jest.fn(),
    onCreate: jest.fn(),
    onShare: jest.fn(),
    onDelete: jest.fn(),
  };
}

describe("CuratedViewsUI", () => {
  it("renders a card per granted view", () => {
    render(<CuratedViewsUI {...baseProps(false)} />);
    expect(screen.getByText("NE Accounts")).toBeInTheDocument();
    expect(screen.getByText("SW Accounts")).toBeInTheDocument();
  });

  it("hides the Create View action for a non-manager", () => {
    render(<CuratedViewsUI {...baseProps(false)} />);
    expect(
      screen.queryByRole("button", { name: /create view/i })
    ).not.toBeInTheDocument();
  });

  it("shows the Create View action for a manager and fires onCreate", async () => {
    const props = baseProps(true);
    render(<CuratedViewsUI {...props} />);
    const btn = screen.getAllByRole("button", { name: /create view/i })[0];
    await userEvent.click(btn);
    expect(props.onCreate).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state when there are no views", () => {
    render(<CuratedViewsUI {...baseProps(false)} views={[]} />);
    expect(screen.getByText("No views available")).toBeInTheDocument();
  });
});
