import { jest } from "@jest/globals";
import type { PortalWithIncludes } from "@portalai/core/contracts";

const { render, screen, fireEvent } = await import("./test-utils");
const { RecentPortalsListUI } =
  await import("../components/RecentPortalsList.component");

const makePortal = (
  overrides: Partial<PortalWithIncludes> = {}
): PortalWithIncludes => ({
  id: "portal-1",
  organizationId: "org-1",
  stationId: "station-1",
  name: "Sales Analysis",
  created: Date.now() - 3600000, // 1 hour ago
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  lastOpened: null,
  ...overrides,
});

const portal1 = makePortal();
const portal2 = makePortal({
  id: "portal-2",
  name: "Finance Report",
  created: Date.now() - 86400000, // 1 day ago
});

const defaultProps = {
  portals: [portal1, portal2],
  onPortalClick: jest.fn(),
  onDeletePortal: jest.fn(),
};

describe("RecentPortalsListUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render portal names", () => {
    render(<RecentPortalsListUI {...defaultProps} />);
    expect(screen.getByText("Sales Analysis")).toBeInTheDocument();
    expect(screen.getByText("Finance Report")).toBeInTheDocument();
  });

  it("should render relative timestamps", () => {
    render(<RecentPortalsListUI {...defaultProps} />);
    expect(screen.getByText("1h ago")).toBeInTheDocument();
    expect(screen.getByText("1d ago")).toBeInTheDocument();
  });

  it("should call onPortalClick with portal id when row is clicked", () => {
    const onPortalClick = jest.fn();
    render(
      <RecentPortalsListUI {...defaultProps} onPortalClick={onPortalClick} />
    );
    fireEvent.click(screen.getByText("Sales Analysis"));
    expect(onPortalClick).toHaveBeenCalledWith("portal-1");
  });

  it("should show empty state when no portals", () => {
    render(<RecentPortalsListUI {...defaultProps} portals={[]} />);
    expect(screen.getByTestId("empty-portals")).toBeInTheDocument();
    expect(
      screen.getByText(
        "No portals yet — open a station to start your first conversation."
      )
    ).toBeInTheDocument();
  });

  it("should display lastOpened timestamp when available", () => {
    const portal = makePortal({
      id: "portal-lo",
      name: "Recently Opened",
      created: Date.now() - 86400000, // 1 day ago
      lastOpened: Date.now() - 3600000, // 1 hour ago
    });
    render(
      <RecentPortalsListUI
        portals={[portal]}
        onPortalClick={jest.fn()}
        onDeletePortal={jest.fn()}
      />
    );
    // Should show lastOpened (1h) not created (1d)
    expect(screen.getByText("1h ago")).toBeInTheDocument();
  });

  it("should fall back to created when lastOpened is null", () => {
    const portal = makePortal({
      id: "portal-null",
      name: "Never Opened",
      created: Date.now() - 86400000, // 1 day ago
      lastOpened: null,
    });
    render(
      <RecentPortalsListUI
        portals={[portal]}
        onPortalClick={jest.fn()}
        onDeletePortal={jest.fn()}
      />
    );
    expect(screen.getByText("1d ago")).toBeInTheDocument();
  });

  it("should render all portals passed", () => {
    const threePortals = [
      portal1,
      portal2,
      makePortal({ id: "portal-3", name: "Marketing Dashboard" }),
    ];
    render(<RecentPortalsListUI {...defaultProps} portals={threePortals} />);
    expect(screen.getByText("Sales Analysis")).toBeInTheDocument();
    expect(screen.getByText("Finance Report")).toBeInTheDocument();
    expect(screen.getByText("Marketing Dashboard")).toBeInTheDocument();
  });

  it("should render station name when stationName is provided", () => {
    const portal = makePortal({ stationName: "Research Station" });
    render(
      <RecentPortalsListUI
        portals={[portal]}
        onPortalClick={jest.fn()}
        onDeletePortal={jest.fn()}
      />
    );
    expect(screen.getByText("Research Station")).toBeInTheDocument();
  });

  it("should not render station name when stationName is absent", () => {
    const portal = makePortal();
    render(
      <RecentPortalsListUI
        portals={[portal]}
        onPortalClick={jest.fn()}
        onDeletePortal={jest.fn()}
      />
    );
    expect(screen.queryByText("Research Station")).not.toBeInTheDocument();
  });

  it("should call onDeletePortal with id and name when delete button is clicked", () => {
    const onDeletePortal = jest.fn();
    render(
      <RecentPortalsListUI {...defaultProps} onDeletePortal={onDeletePortal} />
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    expect(onDeletePortal).toHaveBeenCalledWith("portal-1", "Sales Analysis");
  });

  it("should not trigger onPortalClick when delete button is clicked", () => {
    const onPortalClick = jest.fn();
    const onDeletePortal = jest.fn();
    render(
      <RecentPortalsListUI
        {...defaultProps}
        onPortalClick={onPortalClick}
        onDeletePortal={onDeletePortal}
      />
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    expect(onDeletePortal).toHaveBeenCalled();
    expect(onPortalClick).not.toHaveBeenCalled();
  });

  it("should render a delete button for each portal", () => {
    render(<RecentPortalsListUI {...defaultProps} />);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
  });
});
