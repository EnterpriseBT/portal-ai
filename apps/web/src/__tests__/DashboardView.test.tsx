import { jest } from "@jest/globals";

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const { DashboardViewUI } = await import("../views/Dashboard.view");

// Pure UI: the parts that fetch come in as nodes from the container.
const defaultUIProps = {
  startBox: <form aria-label="Start a portal" />,
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
  });

  it("does not render a default-station line", () => {
    render(<DashboardViewUI {...defaultUIProps} />);
    expect(screen.queryByText(/Default station/i)).not.toBeInTheDocument();
  });

  // #1079: the start box replaces the dashboard's own Open Portal; the
  // header's launcher stays the shell's.
  it("has no Open Portal of its own", () => {
    render(<DashboardViewUI {...defaultUIProps} />);
    expect(
      screen.queryByRole("button", { name: /Open Portal/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("puts the start box in the workbench's start slot, under the h1", () => {
    render(<DashboardViewUI {...defaultUIProps} />);
    const form = screen.getByRole("form", { name: "Start a portal" });
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(
      h1.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      screen.getByTestId("workbench-recent-and-tags")
    ).not.toContainElement(form);
  });
});
