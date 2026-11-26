const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const { DashboardWorkbenchUI } =
  await import("../components/DashboardWorkbench.component");
const { BrowseByTagUI } = await import("../components/BrowseByTag.component");
const { DashboardRecentPortalsUI } =
  await import("../components/DashboardRecentPortals.component");
const { FavoritePinsUI } = await import("../components/FavoritePins.component");
const { FavoriteStationsUI } =
  await import("../components/FavoriteStations.component");
const { NeedsAttentionUI } =
  await import("../components/NeedsAttention.component");
const { StartBoxUI } = await import("../components/StartBox.component");

const noop = () => undefined;
const sections = (empty: boolean) => ({
  start: (
    <StartBoxUI
      stations={empty ? [] : [{ id: "s1", name: "Finance", favorite: true }]}
      initialStationId={empty ? null : "s1"}
      pending={false}
      serverError={null}
      onStart={noop}
    />
  ),
  stations: (
    <FavoriteStationsUI
      items={
        empty
          ? []
          : [{ station: { id: "s1", name: "Finance" }, lastActivity: null }]
      }
      onLaunch={noop}
    />
  ),
  pins: (
    <FavoritePinsUI
      pins={
        empty
          ? []
          : [
              {
                pin: { id: "r1", title: "Q3" },
                status: "ready",
                content: <p>Q3 chart</p>,
              },
            ]
      }
    />
  ),
  recent: (
    <DashboardRecentPortalsUI
      portals={
        empty
          ? []
          : [
              {
                id: "p1",
                name: "Variance",
                stationName: "Finance",
                created: Date.now(),
                lastOpened: null,
              },
            ]
      }
    />
  ),
  tags: (
    <BrowseByTagUI
      tags={
        empty
          ? []
          : [{ tag: { id: "t1", name: "Finance", color: null }, count: 3 }]
      }
      selectedTagId={null}
      onSelectTag={noop}
    />
  ),
  attention: (
    <NeedsAttentionUI
      jobs={
        empty
          ? []
          : [
              {
                id: "j1",
                type: "connector_sync",
                status: "failed",
                where: "CRM",
                updated: Date.now(),
              },
            ]
      }
    />
  ),
});

const body = (name: string) => <p>{name} body</p>;
const ALL = {
  start: body("start"),
  stations: body("stations"),
  pins: body("pins"),
  recent: body("recent"),
  tags: body("tags"),
  attention: body("attention"),
};

describe("DashboardWorkbenchUI", () => {
  it("renders one h1, the start box, then the sections as h2s in workbench order", async () => {
    const { container } = render(<DashboardWorkbenchUI {...ALL} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", { level: 1, name: "Dashboard" })
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    ).toEqual([
      "Favorite stations",
      "Favorite pins",
      "Recent portals",
      "Browse by tag",
      "Needs attention",
    ]);
    expect(screen.getByText("attention body")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("puts Browse by tag under Recent portals, and Needs attention beside both", () => {
    render(<DashboardWorkbenchUI {...ALL} />);
    const h2 = (name: string) =>
      screen.getByRole("heading", { level: 2, name });
    const left = screen.getByTestId("workbench-recent-and-tags");
    const right = screen.getByTestId("workbench-attention");
    expect(left).toContainElement(h2("Recent portals"));
    expect(left).toContainElement(h2("Browse by tag"));
    expect(right).toContainElement(h2("Needs attention"));
    expect(right).not.toContainElement(h2("Recent portals"));
    // Reading order follows the layout: the left column, then the right.
    expect(
      left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("gives Needs attention the full row when the left column is empty", () => {
    render(<DashboardWorkbenchUI attention={body("attention")} />);
    expect(screen.queryByTestId("workbench-recent-and-tags")).toBeNull();
    expect(screen.getByTestId("workbench-attention")).toBeInTheDocument();
  });

  it("links each favorites section to its list, and Recent portals nowhere", () => {
    render(<DashboardWorkbenchUI {...ALL} />);
    expect(screen.getByRole("link", { name: "All stations" })).toHaveAttribute(
      "href",
      "/stations"
    );
    expect(
      screen.getByRole("link", { name: "All pinned results" })
    ).toHaveAttribute("href", "/portal-results");
    expect(screen.getByRole("link", { name: "All tags" })).toHaveAttribute(
      "href",
      "/tags"
    );
    expect(screen.getByRole("link", { name: "All jobs" })).toHaveAttribute(
      "href",
      "/jobs"
    );
    expect(screen.queryByRole("link", { name: /portals/i })).toBeNull();
  });

  it("leaves out a section whose slot isn't given", async () => {
    const { container } = render(
      <DashboardWorkbenchUI recent={body("recent")} />
    );
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    ).toEqual(["Recent portals"]);
    await expectNoAxeViolations(container);
  });

  it.each([
    ["populated", false],
    ["new org (every section empty)", true],
  ])("has no axe violations with real sections: %s", async (_label, empty) => {
    const { container } = render(<DashboardWorkbenchUI {...sections(empty)} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("form", { name: "Start a portal" })
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("renders the header's action and content", () => {
    render(
      <DashboardWorkbenchUI
        headerAction={<button type="button">Open Portal</button>}
        headerContent={<p>API connected — dev (local)</p>}
      />
    );
    expect(
      screen.getByRole("button", { name: "Open Portal" })
    ).toBeInTheDocument();
    expect(screen.getByText("API connected — dev (local)")).toBeInTheDocument();
  });
});
