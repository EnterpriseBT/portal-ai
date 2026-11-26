const { expectNoAxeViolations, render, screen, within } =
  await import("./test-utils");
const { DashboardRecentPortalsUI } =
  await import("../components/DashboardRecentPortals.component");

const portal = (n: number) => ({
  id: `p${n}`,
  name: `Portal ${n}`,
  stationName: `Station ${n}`,
  created: Date.now() - n * 3600_000,
  lastOpened: null,
});

describe("DashboardRecentPortalsUI", () => {
  it("links each portal and shows its station", async () => {
    const { container } = render(
      <DashboardRecentPortalsUI portals={[portal(1), portal(2)]} />
    );
    expect(screen.getByRole("link", { name: "Portal 1" })).toHaveAttribute(
      "href",
      "/portals/p1"
    );
    expect(screen.getByText("Station 2")).toBeInTheDocument();
    expect(screen.getByText("1h ago")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows at most five, with no see-all", () => {
    render(
      <DashboardRecentPortalsUI portals={[1, 2, 3, 4, 5, 6].map(portal)} />
    );
    const list = screen.getByRole("list", { name: "Recent portals" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryByText("Portal 6")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /see all/i })
    ).not.toBeInTheDocument();
  });

  it("shows a teaching empty state", async () => {
    const { container } = render(<DashboardRecentPortalsUI portals={[]} />);
    expect(screen.getByText("No portals yet")).toBeInTheDocument();
    expect(screen.getByText(/Ask a question above/)).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
