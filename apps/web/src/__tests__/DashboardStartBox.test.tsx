/**
 * #1079: the dashboard's start box, wired to the shell's one launcher and a
 * station search.
 */
import { jest } from "@jest/globals";

import type { ActionGate } from "@portalai/core/ui";
import type { PortalLauncher } from "../utils/use-portal-launcher.util";

type Row = { id: string; name: string };
// The caller's recently opened portals, newest first, with their stations.
let mockRecentPortals: { stationId: string; stationName?: string | null }[];
// The org's stations, newest first (an empty query's last source).
let mockNewestStations: Row[];
const mockStationsList = jest.fn(
  (
    params: { search?: string; sortBy?: string },
    _options?: { enabled?: boolean }
  ) =>
    params.search === undefined
      ? { data: { stations: mockNewestStations }, isFetching: false }
      : { data: undefined, isFetching: false }
);
const mockPortalsList = jest.fn((_params: unknown) => ({
  data: { portals: mockRecentPortals },
}));

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    stations: { list: mockStationsList },
    portals: { list: mockPortalsList },
  },
}));

const { act, expectNoAxeViolations, render, screen } =
  await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { DashboardStartBox } =
  await import("../components/DashboardStartBox.component");
const { PortalLauncherContext } =
  await import("../utils/portal-launcher.context");

const onStart = jest.fn();
const launcherWith = (
  overrides: Partial<PortalLauncher> = {}
): PortalLauncher => ({
  station: { id: "s-last", name: "Ops" },
  pageStation: null,
  favoriteStations: [{ id: "s-fav", name: "Finance" }],
  settling: false,
  gate: { kind: "allow" } as ActionGate,
  pending: false,
  launch: jest.fn(),
  chooser: {
    open: false,
    onOpen: jest.fn(),
    onClose: jest.fn(),
    onSubmit: jest.fn(),
    serverError: null,
  },
  startBox: { onStart, serverError: null },
  ...overrides,
});

const Box = ({ launcher }: { launcher: PortalLauncher }) => (
  <PortalLauncherContext.Provider value={launcher}>
    <DashboardStartBox />
  </PortalLauncherContext.Provider>
);

const field = () => screen.getByRole("textbox", { name: "Ask a question" });

beforeEach(() => {
  onStart.mockReset();
  mockStationsList.mockClear();
  mockPortalsList.mockClear();
  mockRecentPortals = [{ stationId: "s-last", stationName: "Ops" }];
  mockNewestStations = [];
});

const listedNames = async () => {
  const list = await screen.findByRole("listbox");
  return Array.from(list.querySelectorAll('[role="option"]')).map(
    (option) =>
      option.querySelector("span:not([aria-hidden]):not([hidden])")?.textContent
  );
};

describe("DashboardStartBox (#1079)", () => {
  it("preselects the launcher's station and starts there", async () => {
    const { container } = render(<Box launcher={launcherWith()} />);
    expect(
      screen.getByRole("button", { name: /^Ops, station/ })
    ).toBeInTheDocument();
    await userEvent.type(field(), "Top accounts{Enter}");
    expect(onStart).toHaveBeenCalledWith({
      stationId: "s-last",
      initialMessage: "Top accounts",
    });
    await expectNoAxeViolations(container);
  });

  it("keeps a picked station when the recent portals reload", async () => {
    const { rerender } = render(<Box launcher={launcherWith()} />);
    await userEvent.click(screen.getByRole("button", { name: /Ops, station/ }));
    await userEvent.click(
      await screen.findByRole("option", { name: /Finance/ })
    );
    // The last-used station moves on after a reload.
    rerender(
      <Box launcher={launcherWith({ station: { id: "s-new", name: "New" } })} />
    );
    expect(
      screen.getByRole("button", { name: /^Finance, station/ })
    ).toBeInTheDocument();
    await userEvent.type(field(), "Top accounts{Enter}");
    expect(onStart).toHaveBeenCalledWith({
      stationId: "s-fav",
      initialMessage: "Top accounts",
    });
  });

  it("searches stations by the debounced query, only once one is typed", async () => {
    jest.useFakeTimers();
    try {
      const user = userEvent.setup({
        advanceTimers: jest.advanceTimersByTime,
      });
      render(<Box launcher={launcherWith()} />);
      const enabledCalls = () =>
        mockStationsList.mock.calls.filter(
          ([params, options]) => params.search !== undefined && options?.enabled
        );
      expect(enabledCalls()).toHaveLength(0);

      await user.click(screen.getByRole("button", { name: /Ops, station/ }));
      await user.type(
        await screen.findByRole("combobox", { name: "Search stations" }),
        "fin"
      );
      act(() => {
        jest.advanceTimersByTime(500);
      });
      const [params] = enabledCalls().at(-1)!;
      expect(params).toEqual(
        expect.objectContaining({ search: "fin", limit: 10, offset: 0 })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  const failed = () =>
    launcherWith({
      startBox: {
        onStart,
        serverError: { message: "Couldn't start", code: "PORTAL_FAILED" },
      },
    });

  it("shows a start failure in the box", async () => {
    render(<Box launcher={failed()} />);
    await userEvent.type(field(), "Top accounts{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't start");
  });

  // #1137 code review: the launcher outlives the dashboard, so its last
  // error mustn't greet the box on the next visit.
  it("doesn't show an earlier visit's failure", () => {
    render(<Box launcher={failed()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // An empty search suggests up to five stations: those of the caller's
  // most recently opened portals, then favorites, then the newest stations.
  describe("suggestions for an empty search", () => {
    it("lists recent portals' stations, then favorites, then the newest, five at most", async () => {
      mockRecentPortals = [
        { stationId: "s-a", stationName: "Alpha" },
        { stationId: "s-b", stationName: "Beta" },
        // A second portal on Alpha counts once.
        { stationId: "s-a", stationName: "Alpha" },
      ];
      mockNewestStations = [
        { id: "s-new1", name: "Newest" },
        { id: "s-fav", name: "Finance" },
        { id: "s-new2", name: "Newer" },
        { id: "s-new3", name: "New" },
      ];
      render(
        <Box
          launcher={launcherWith({
            station: { id: "s-a", name: "Alpha" },
            favoriteStations: [{ id: "s-fav", name: "Finance" }],
          })}
        />
      );
      await userEvent.click(
        screen.getByRole("button", { name: /Alpha, station/ })
      );
      expect(await listedNames()).toEqual([
        "Alpha",
        "Beta",
        "Finance",
        "Newest",
        "Newer",
      ]);
      expect(mockPortalsList).toHaveBeenCalledWith(
        expect.objectContaining({
          mine: "true",
          sortBy: "lastOpened",
          sortOrder: "desc",
          include: "station",
        })
      );
      expect(mockStationsList).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: "created", sortOrder: "desc" })
      );
    });

    it("skips a recent portal whose station has no name to show", async () => {
      mockRecentPortals = [
        { stationId: "s-gone", stationName: null },
        { stationId: "s-last", stationName: "Ops" },
      ];
      render(<Box launcher={launcherWith()} />);
      await userEvent.click(
        screen.getByRole("button", { name: /Ops, station/ })
      );
      expect(await listedNames()).toEqual(["Ops", "Finance"]);
    });

    it("keeps the preselected station listed though it's past the first five", async () => {
      mockRecentPortals = [];
      mockNewestStations = [1, 2, 3, 4, 5].map((n) => ({
        id: `s-${n}`,
        name: `Station ${n}`,
      }));
      render(
        <Box
          launcher={launcherWith({
            station: { id: "s-old", name: "Old" },
            favoriteStations: [],
          })}
        />
      );
      await userEvent.click(
        screen.getByRole("button", { name: /Old, station/ })
      );
      expect(await listedNames()).toEqual([
        "Station 1",
        "Station 2",
        "Station 3",
        "Station 4",
        "Station 5",
        "Old",
      ]);
    });
  });
});
