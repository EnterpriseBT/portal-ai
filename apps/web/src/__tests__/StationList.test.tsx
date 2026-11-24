import { jest } from "@jest/globals";
import type { StationListResponsePayload } from "@portalai/core/contracts";

const { expectNoAxeViolations, render, screen, within } =
  await import("./test-utils");
const { StationListUI, StationCardUI } =
  await import("../components/StationList.component");
const { expectEmptyListHelp } = await import("./empty-list-help.assert");

type StationFixture = StationListResponsePayload["stations"][number];
const makeStation = (
  overrides: Partial<StationFixture> = {}
): StationFixture => ({
  id: "station-1",
  organizationId: "org-1",
  name: "Sales Analytics",
  description: "Sales data analysis station",
  enabledToolpacks: ["data_query", "statistics"],
  created: 1710000000000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  capabilities: { read: true, write: true, delete: true, share: true },
  ...overrides,
});

const station1 = makeStation();
const station2 = makeStation({
  id: "station-2",
  name: "Finance Hub",
  description: "Financial reporting",
  enabledToolpacks: ["data_query", "financial"],
});

const defaultCardProps = {
  station: station1,
  onDelete: jest.fn(),
};

describe("StationCardUI", () => {
  // #1070: a station's tags, from the list's include=tags.
  it("shows the station's tags, and no tag row without any", () => {
    const { rerender } = render(
      <StationCardUI
        {...defaultCardProps}
        station={{
          ...defaultCardProps.station,
          tags: [
            {
              id: "tag-1",
              organizationId: "org-1",
              name: "Finance",
              color: "#2563EB",
              description: null,
              sourcePortalId: null,
              created: 1,
              createdBy: "user-1",
              updated: null,
              updatedBy: null,
              deleted: null,
              deletedBy: null,
            },
          ],
        }}
      />
    );
    expect(screen.getByText("Finance")).toBeInTheDocument();
    rerender(<StationCardUI {...defaultCardProps} />);
    expect(screen.queryByText("Tags")).toBeNull();
  });

  it("should render station name and description", () => {
    render(<StationCardUI {...defaultCardProps} />);
    expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
    expect(screen.getByText("Sales data analysis station")).toBeInTheDocument();
  });

  it("should render tool packs as chips", () => {
    render(<StationCardUI {...defaultCardProps} />);
    expect(screen.getByText("Data Query")).toBeInTheDocument();
    expect(screen.getByText("Statistics")).toBeInTheDocument();
  });

  // #284: a pack the plan no longer includes stays listed but reads as inert.
  it("should render an unentitled tool pack as an inert chip", () => {
    render(
      <StationCardUI
        {...defaultCardProps}
        entitledBuiltinSlugs={new Set(["data_query"])}
      />
    );
    // Both packs still named; only the unentitled one is marked.
    expect(screen.getByText("Data Query")).toBeInTheDocument();
    expect(screen.getByText("Statistics")).toBeInTheDocument();
    const inert = document.querySelectorAll('[data-entitled="false"]');
    expect(inert).toHaveLength(1);
    expect(inert[0]).toHaveAttribute(
      "aria-label",
      "Statistics — Not included in your plan"
    );
  });

  // #1063: the station read names its custom packs.
  it("names a custom pack from the station's toolpacks", () => {
    render(
      <StationCardUI
        {...defaultCardProps}
        station={makeStation({
          enabledToolpacks: ["data_query", "org:tp-1"],
          toolpacks: [
            { ref: "data_query", kind: "builtin", name: "Data Query" },
            { ref: "org:tp-1", kind: "custom", name: "Acme CRM" },
          ],
        })}
      />
    );
    expect(screen.getByText("Acme CRM")).toBeInTheDocument();
    expect(screen.queryByText("org:tp-1")).not.toBeInTheDocument();
  });

  it("marks a custom pack not included on a plan without custom packs (#1063)", () => {
    render(
      <StationCardUI
        {...defaultCardProps}
        customPacksEntitled={false}
        station={makeStation({
          enabledToolpacks: ["data_query", "org:tp-1"],
          toolpacks: [
            { ref: "data_query", kind: "builtin", name: "Data Query" },
            { ref: "org:tp-1", kind: "custom", name: "Acme CRM" },
          ],
        })}
      />
    );
    const inert = document.querySelectorAll('[data-entitled="false"]');
    expect(inert).toHaveLength(1);
    expect(inert[0]).toHaveAttribute(
      "aria-label",
      "Acme CRM — Not included in your plan"
    );
  });

  // #1114: the org-wide default station is gone from the card.
  it("offers no default-station action or badge", () => {
    render(<StationCardUI {...defaultCardProps} />);
    expect(
      screen.queryByRole("button", { name: "Set as default" })
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Default")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("#690: shows Delete when the station's capabilities allow it", () => {
    render(<StationCardUI {...defaultCardProps} />);
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("#690: hides Delete on a station the caller can't delete", () => {
    render(
      <StationCardUI
        {...defaultCardProps}
        station={makeStation({
          capabilities: {
            read: true,
            write: false,
            delete: false,
            share: false,
          },
        })}
      />
    );
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });

  it("#690: a read-only card renders no actions at all", () => {
    render(
      <StationCardUI
        {...defaultCardProps}
        station={makeStation({
          capabilities: {
            read: true,
            write: false,
            delete: false,
            share: false,
          },
        })}
      />
    );
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  // #794: the card opens its station through its title's link, an h2 named
  // by the title alone, and its actions are described by that title.
  it("links its title to the station, as an h2", () => {
    render(<StationCardUI {...defaultCardProps} />);
    const link = screen.getByRole("link", { name: "Sales Analytics" });
    expect(link).toHaveAttribute("href", `/stations/${station1.id}`);
    expect(
      screen.getByRole("heading", { level: 2, name: "Sales Analytics" })
    ).toContainElement(link);
    expect(
      screen.getByRole("button", { name: "Delete" })
    ).toHaveAccessibleDescription("Sales Analytics");
  });
});

const defaultListProps = {
  stations: [station1, station2],
  onDelete: jest.fn(),
};

describe("StationListUI", () => {
  // #794: a card list is a named list of items.
  it("renders the stations as a named list", () => {
    render(<StationListUI {...defaultListProps} />);
    const list = screen.getByRole("list", { name: "Stations" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
  });

  it("should render multiple station cards", () => {
    render(<StationListUI {...defaultListProps} />);
    expect(screen.getByText("Sales Analytics")).toBeInTheDocument();
    expect(screen.getByText("Finance Hub")).toBeInTheDocument();
  });

  it("#690: Delete shows only on the rows the caller may delete", () => {
    render(
      <StationListUI
        {...defaultListProps}
        stations={[
          station1,
          makeStation({
            id: "station-2",
            name: "Finance Hub",
            capabilities: {
              read: true,
              write: false,
              delete: false,
              share: false,
            },
          }),
        ]}
      />
    );
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
  });

  it("should show empty state when no stations", () => {
    render(<StationListUI {...defaultListProps} stations={[]} />);
    expect(screen.getByText("No stations found")).toBeInTheDocument();
    expectEmptyListHelp("stations");
  });

  it("keeps No results for a filter that matches nothing (#1059)", () => {
    render(
      <StationListUI {...defaultListProps} stations={[]} hasActiveFilters />
    );
    expect(screen.getByText(/No results found/)).toBeInTheDocument();
    expect(screen.queryByText("No stations found")).toBeNull();
  });

  it("has no axe violations, with an unentitled pack", async () => {
    const { container } = render(
      <StationListUI
        {...defaultListProps}
        entitledBuiltinSlugs={new Set(["data_query"])}
      />
    );
    await expectNoAxeViolations(container);
  });
});

describe("StationListUI favorites (#1072)", () => {
  it("puts each station's title action beside its name", () => {
    render(
      <StationListUI
        {...defaultListProps}
        renderTitleAction={(s) => (
          <button
            type="button"
            aria-pressed="false"
          >{`Favorite ${s.name}`}</button>
        )}
      />
    );
    expect(
      screen.getByRole("button", { name: "Favorite Sales Analytics" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Favorite Finance Hub" })
    ).toBeInTheDocument();
  });

  it("explains favorites when the Favorites toggle is the filter and nothing is starred", () => {
    render(
      <StationListUI
        {...defaultListProps}
        stations={[]}
        favoritesOnly
        hasActiveFilters
      />
    );
    expect(screen.getByText("No favorites yet")).toBeInTheDocument();
    expect(screen.queryByText("No results found")).not.toBeInTheDocument();
  });

  it("says no results when another filter narrows it too", () => {
    render(
      <StationListUI {...defaultListProps} stations={[]} hasActiveFilters />
    );
    expect(screen.getByText("No results found")).toBeInTheDocument();
    expect(screen.queryByText("No favorites yet")).not.toBeInTheDocument();
  });
});
