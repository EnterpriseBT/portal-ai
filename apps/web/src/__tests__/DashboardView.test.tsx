import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen, fireEvent } =
  await import("./test-utils");
const { DashboardViewUI } = await import("../views/Dashboard.view");

// Pure UI: the parts that fetch come in as nodes from the container.
const defaultUIProps = {
  onNewPortal: jest.fn(),
  healthCheck: <span>API connected — dev (local)</span>,
  recentPortals: <p>recent portals body</p>,
  pinnedResults: <p>pinned results body</p>,
};

describe("DashboardViewUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders one h1, with Recent portals in the workbench and Pinned Results after it", async () => {
    const { container } = render(<DashboardViewUI {...defaultUIProps} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Dashboard" })
    ).toBeInTheDocument();
    const h2s = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(h2s.indexOf("Recent portals")).toBeGreaterThanOrEqual(0);
    expect(h2s.indexOf("Pinned Results")).toBeGreaterThan(
      h2s.indexOf("Recent portals")
    );
    const workbench = screen.getByTestId("workbench-recent-and-tags");
    expect(workbench).toContainElement(
      screen.getByRole("heading", { name: "Recent portals" })
    );
    expect(workbench).toContainElement(screen.getByText("recent portals body"));
    expect(workbench).not.toContainElement(
      screen.getByText("pinned results body")
    );
    expect(screen.getByText("API connected — dev (local)")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("leaves out the sections later tickets fill", () => {
    render(<DashboardViewUI {...defaultUIProps} />);
    for (const name of [
      "Favorite stations",
      "Favorite pins",
      "Browse by tag",
      "Needs attention",
    ]) {
      expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
    }
    expect(
      screen.queryByRole("form", { name: "Start a portal" })
    ).not.toBeInTheDocument();
  });

  it("does not render a default-station line", () => {
    render(<DashboardViewUI {...defaultUIProps} />);
    expect(screen.queryByText(/Default station/i)).not.toBeInTheDocument();
  });

  it("calls onNewPortal when the header's Open Portal is clicked", () => {
    const onNewPortal = jest.fn();
    render(<DashboardViewUI {...defaultUIProps} onNewPortal={onNewPortal} />);
    fireEvent.click(screen.getByRole("button", { name: /Open Portal/i }));
    expect(onNewPortal).toHaveBeenCalled();
  });
});
