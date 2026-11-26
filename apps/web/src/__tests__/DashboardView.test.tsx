import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen, fireEvent } =
  await import("./test-utils");
const { DashboardViewUI } = await import("../views/Dashboard.view");

const defaultUIProps = {
  onNewPortal: jest.fn(),
  onDeletePortal: jest.fn(),
  onUnpin: jest.fn(),
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
    expect(screen.getByTestId("workbench-recent-and-tags")).toContainElement(
      screen.getByRole("heading", { name: "Recent portals" })
    );
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
