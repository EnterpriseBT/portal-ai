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
type ActionGate = import("@portalai/core/ui").ActionGate;

const views = [
  {
    id: "cv-1",
    organizationId: "org-1",
    connectorEntityId: "ent-1",
    key: "ne_accounts",
    label: "NE Accounts",
    description: "North-east accounts",
    filter: null,
    filtered: false,
    projected: false,
    entity: { key: "accounts", label: "Accounts" },
    capabilities: { read: true, write: true, delete: true, share: true },
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
    // #680: a reader without write on the view gets no filter contents.
    filter: null,
    filtered: true,
    projected: true,
    entity: null,
    // #688: shared Read with the caller.
    capabilities: { read: true, write: false, delete: false, share: false },
    created: Date.now(),
    createdBy: "u1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
] as unknown as Parameters<typeof CuratedViewsUI>[0]["views"];

const ALLOW = { kind: "allow" } as const;
const HIDE = { kind: "hide" } as const;

function baseProps(createGate: ActionGate = HIDE) {
  return {
    views,
    isLoading: false,
    isError: false,
    createGate,
    hasActiveFilters: false,
    paginationToolbar: <div data-testid="pagination-toolbar" />,
    onOpen: jest.fn(),
    onCreate: jest.fn(),
    onShare: jest.fn(),
    onDelete: jest.fn(),
  };
}

describe("CuratedViewsUI", () => {
  it("#680: Row filter reads `filtered`, not the (redacted) filter", () => {
    render(<CuratedViewsUI {...baseProps()} />);
    expect(screen.getByText("All rows")).toBeInTheDocument();
    expect(screen.getByText("Filtered")).toBeInTheDocument();
  });

  it("renders a card per granted view", () => {
    render(<CuratedViewsUI {...baseProps()} />);
    expect(screen.getByText("NE Accounts")).toBeInTheDocument();
    expect(screen.getByText("SW Accounts")).toBeInTheDocument();
  });

  it("renders the entity label on a card (#646)", () => {
    render(<CuratedViewsUI {...baseProps()} />);
    // cv-1 carries entity { label: "Accounts" }; cv-2's entity is null → no row.
    expect(screen.getByText("Accounts")).toBeInTheDocument();
  });

  it("hides the Create View action for a caller who can't read views", () => {
    render(<CuratedViewsUI {...baseProps()} />);
    expect(
      screen.queryByRole("button", { name: /create view/i })
    ).not.toBeInTheDocument();
  });

  it("shows the Create View action when allowed and fires onCreate", async () => {
    const props = baseProps(ALLOW);
    render(<CuratedViewsUI {...props} />);
    const btn = screen.getAllByRole("button", { name: /create view/i })[0];
    await userEvent.click(btn);
    expect(props.onCreate).toHaveBeenCalledTimes(1);
  });

  it("renders the empty state when there are no views", () => {
    render(<CuratedViewsUI {...baseProps()} views={[]} />);
    expect(screen.getByText("No views available")).toBeInTheDocument();
  });

  it("#688: Create is disabled with the grant hint for a caller who reads views but can't create them", async () => {
    const props = baseProps({
      kind: "disable",
      reason: "Ask for access to create views",
    });
    render(<CuratedViewsUI {...props} />);
    const btn = screen.getAllByRole("button", { name: /create view/i })[0];
    expect(btn).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(btn);
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  const cardFor = (label: string) =>
    screen.getByText(label).closest(".MuiCard-root") as HTMLElement;

  it("#688: a row the caller owns shows Share and Delete", async () => {
    const { within } = await import("@testing-library/react");
    render(<CuratedViewsUI {...baseProps()} />);
    const card = within(cardFor("NE Accounts"));
    expect(card.getByRole("button", { name: /share/i })).toBeInTheDocument();
    expect(card.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("#688: a read-only row shows neither Share nor Delete", async () => {
    const { within } = await import("@testing-library/react");
    render(<CuratedViewsUI {...baseProps()} />);
    const card = within(cardFor("SW Accounts"));
    expect(card.queryByRole("button", { name: /share/i })).toBeNull();
    expect(card.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("#688: a row with delete but not share shows Delete only", async () => {
    const { within } = await import("@testing-library/react");
    const writer = {
      ...views[0],
      id: "cv-3",
      label: "Writable",
      capabilities: { read: true, write: true, delete: true, share: false },
    };
    render(<CuratedViewsUI {...baseProps()} views={[writer]} />);
    const card = within(cardFor("Writable"));
    expect(card.queryByRole("button", { name: /share/i })).toBeNull();
    expect(card.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });
});
