import { jest } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockStationsGet = jest.fn();
const mockOrganizationsUsage = jest.fn<
  () => { data: unknown; isLoading: boolean; isError: boolean; error: null }
>(() => ({
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
}));
const mockToolpacksList = jest.fn(() => ({
  data: undefined,
  isLoading: true,
  isError: false,
  isSuccess: false,
  error: null,
}));

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    stations: { get: mockStationsGet },
    organizations: { usage: mockOrganizationsUsage },
    toolpacks: { list: mockToolpacksList },
  },
  queryKeys: {},
}));

const { render, screen, fireEvent } = await import("./test-utils");
const { PortalHeaderMeta, PortalHeaderMetaUI } =
  await import("../components/PortalHeaderMeta.component");

// ── matchMedia helpers ───────────────────────────────────────────────

const mockBreakpoint = (breakpoint: "mobile" | "desktop") => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => {
      let matches = false;
      if (breakpoint === "mobile") {
        matches = query.includes("max-width") && !query.includes("min-width");
      } else if (breakpoint === "desktop") {
        matches = query.includes("min-width") && !query.includes("max-width");
      }
      return {
        matches,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      };
    },
  });
};

const resetMatchMedia = () => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
};

// ── Fixtures ─────────────────────────────────────────────────────────

const stationFixture = {
  station: {
    id: "station-1",
    organizationId: "org-1",
    name: "Sales Station",
    description: null,
    enabledToolpacks: ["data_query", "statistics"],
    created: Date.now(),
    createdBy: "user-1",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    instances: [
      {
        id: "si-1",
        stationId: "station-1",
        connectorInstanceId: "ci-1",
        connectorInstance: { id: "ci-1", name: "My CRM" },
        canRead: true,
      },
      {
        id: "si-2",
        stationId: "station-1",
        connectorInstanceId: "ci-2",
        connectorInstance: { id: "ci-2", name: "My CSV" },
        canRead: true,
      },
    ],
    views: [
      {
        id: "sv-1",
        stationId: "station-1",
        curatedViewId: "cv-1",
        curatedView: { id: "cv-1", key: "q3", label: "Q3 orders" },
        canRead: true,
      },
    ],
  },
};

const mockStationResult = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
});

const usageFixture = {
  tier: { tier: "standard" },
  usage: {
    periodId: "2026-07",
    byClass: {
      free: { used: 3, available: null },
      metered: { used: 12, available: 88 },
      expensive: { used: 2, available: 8 },
    },
  },
};

// ── Tests ────────────────────────────────────────────────────────────

describe("PortalHeaderMeta", () => {
  beforeEach(() => {
    mockStationsGet.mockReset();
    mockOrganizationsUsage.mockReset();
    mockOrganizationsUsage.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
    });
    resetMatchMedia();
  });

  afterEach(() => {
    resetMatchMedia();
  });

  it("shows only the usage strip while the station query loads", () => {
    mockStationsGet.mockReturnValue(mockStationResult(undefined));
    mockOrganizationsUsage.mockReturnValue({
      data: usageFixture,
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<PortalHeaderMeta stationId="station-1" />);
    expect(screen.getByText("Metered usage")).toBeInTheDocument();
    expect(
      screen.queryByTestId("portal-header-station-link")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("portal-header-station-unavailable")
    ).not.toBeInTheDocument();
  });

  // #699: a revoked share or a deleted station answers 404 (unreadable ==
  // absent). The header used to vanish entirely, usage rows included.
  it("says the station is unavailable on a 404 and keeps the usage strip", () => {
    mockStationsGet.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: {
        status: 404,
        code: "STATION_NOT_FOUND",
        message: "Station not found",
      },
    });
    mockOrganizationsUsage.mockReturnValue({
      data: usageFixture,
      isLoading: false,
      isError: false,
      error: null,
    });
    render(<PortalHeaderMeta stationId="station-1" />);
    expect(
      screen.getByTestId("portal-header-station-unavailable")
    ).toHaveTextContent("This portal's station isn't available to you.");
    expect(screen.getByText("Metered usage")).toBeInTheDocument();
    expect(
      screen.queryByTestId("portal-header-station-link")
    ).not.toBeInTheDocument();
  });

  // Code review on #699: a refetch that 404s keeps the previous data, which
  // must not keep showing the station beside a locked composer.
  it("treats a 404 as unavailable even when stale station data is cached", () => {
    mockStationsGet.mockReturnValue({
      data: stationFixture,
      isLoading: false,
      isError: true,
      error: {
        status: 404,
        code: "STATION_NOT_FOUND",
        message: "Station not found",
      },
    });
    render(<PortalHeaderMeta stationId="station-1" />);
    expect(
      screen.getByTestId("portal-header-station-unavailable")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("portal-header-station-link")
    ).not.toBeInTheDocument();
  });

  it("says the station failed to load on any other error, not that it's unavailable", () => {
    mockStationsGet.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 503, code: "DB_ADMISSION_TIMEOUT", message: "busy" },
    });
    render(<PortalHeaderMeta stationId="station-1" />);
    expect(
      screen.getByTestId("portal-header-station-load-failed")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("portal-header-station-unavailable")
    ).not.toBeInTheDocument();
  });

  it("reads only a STATION_NOT_FOUND 404 as unavailable", () => {
    mockStationsGet.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { status: 404, code: "NOT_FOUND", message: "Not found" },
    });
    render(<PortalHeaderMeta stationId="station-1" />);
    expect(
      screen.queryByTestId("portal-header-station-unavailable")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("portal-header-station-load-failed")
    ).toBeInTheDocument();
  });

  describe("PortalHeaderMetaUI (#699)", () => {
    const uiProps = {
      station: null,
      stationUnavailable: false,
      usage: usageFixture.usage.byClass,
      isEntitled: () => true,
      isMobile: false,
      expanded: false,
      onToggleExpanded: () => {},
    };

    it("renders the unavailable line with usage and no station rows", () => {
      render(<PortalHeaderMetaUI {...uiProps} stationUnavailable />);
      expect(
        screen.getByTestId("portal-header-station-unavailable")
      ).toBeInTheDocument();
      expect(screen.getByText("Expensive usage")).toBeInTheDocument();
      expect(screen.queryByText("Connectors")).not.toBeInTheDocument();
    });

    it("renders the station rows when the station is present", () => {
      render(
        <PortalHeaderMetaUI
          {...uiProps}
          station={stationFixture.station as never}
        />
      );
      expect(
        screen.getByTestId("portal-header-station-link")
      ).toHaveTextContent("Sales Station");
      expect(
        screen.queryByTestId("portal-header-station-unavailable")
      ).not.toBeInTheDocument();
    });
  });

  describe("Desktop layout", () => {
    beforeEach(() => mockBreakpoint("desktop"));

    it("renders the station link pointing at the station detail route", () => {
      mockStationsGet.mockReturnValue(mockStationResult(stationFixture));
      render(<PortalHeaderMeta stationId="station-1" />);
      const link = screen.getByTestId("portal-header-station-link");
      expect(link).toHaveTextContent("Sales Station");
      expect(link).toHaveAttribute("href", "/stations/station-1");
    });

    it("renders one chip per connector instance", () => {
      mockStationsGet.mockReturnValue(mockStationResult(stationFixture));
      render(<PortalHeaderMeta stationId="station-1" />);
      expect(screen.getByText("My CRM")).toBeInTheDocument();
      expect(screen.getByText("My CSV")).toBeInTheDocument();
    });

    it("renders one chip per tool pack", () => {
      mockStationsGet.mockReturnValue(mockStationResult(stationFixture));
      render(<PortalHeaderMeta stationId="station-1" />);
      // ToolPackChip uses ToolPackUtil.getLabel — verify both pack labels appear
      expect(screen.getByText(/data query/i)).toBeInTheDocument();
      expect(screen.getByText(/statistics/i)).toBeInTheDocument();
    });

    it("does not render the mobile toggle on desktop", () => {
      mockStationsGet.mockReturnValue(mockStationResult(stationFixture));
      render(<PortalHeaderMeta stationId="station-1" />);
      expect(
        screen.queryByTestId("portal-header-meta-toggle")
      ).not.toBeInTheDocument();
    });

    it("#674: fetches both attachment kinds", () => {
      mockStationsGet.mockReturnValue(mockStationResult(stationFixture));
      render(<PortalHeaderMeta stationId="station-1" />);
      expect(mockStationsGet).toHaveBeenCalledWith(
        "station-1",
        { include: "connectorInstance,curatedView" },
        { enabled: true }
      );
    });

    it("#674: renders a Views row beside Connectors, with no alert when both are attached", () => {
      mockStationsGet.mockReturnValue(mockStationResult(stationFixture));
      render(<PortalHeaderMeta stationId="station-1" />);
      expect(screen.getByText("Views")).toBeInTheDocument();
      expect(screen.getByText("Q3 orders")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("#674: shows an unreadable attachment as a locked chip with its real name", () => {
      const locked = {
        ...stationFixture,
        station: {
          ...stationFixture.station,
          views: [
            {
              ...stationFixture.station.views[0],
              curatedView: { id: "cv-1", key: "pay", label: "Payroll" },
              canRead: false,
            },
          ],
        },
      };
      mockStationsGet.mockReturnValue(mockStationResult(locked));
      render(<PortalHeaderMeta stationId="station-1" />);
      expect(screen.getByTestId("attachment-chip-no-access")).toHaveTextContent(
        "Payroll"
      );
    });

    it("#674: keeps both rows when empty, shows —, and one combined alert", () => {
      const bare = {
        ...stationFixture,
        station: { ...stationFixture.station, instances: [], views: [] },
      };
      mockStationsGet.mockReturnValue(mockStationResult(bare));
      render(<PortalHeaderMeta stationId="station-1" />);
      expect(screen.getByText("Connectors")).toBeInTheDocument();
      expect(screen.getByText("Views")).toBeInTheDocument();
      expect(screen.getAllByText("—")).toHaveLength(2);
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toHaveTextContent(
        "No views or connectors are attached to this station yet."
      );
    });

    it("#674: names only the missing kind", () => {
      const noViews = {
        ...stationFixture,
        station: { ...stationFixture.station, views: [] },
      };
      mockStationsGet.mockReturnValue(mockStationResult(noViews));
      render(<PortalHeaderMeta stationId="station-1" />);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No views are attached to this station yet."
      );
    });

    it("hides the Tool Packs section when the station has none", () => {
      const bare = {
        ...stationFixture,
        station: { ...stationFixture.station, enabledToolpacks: [] },
      };
      mockStationsGet.mockReturnValue(mockStationResult(bare));
      render(<PortalHeaderMeta stationId="station-1" />);
      expect(screen.queryByText("Tool Packs")).not.toBeInTheDocument();
    });

    it("shows metered and expensive usage once the balance resolves", () => {
      mockStationsGet.mockReturnValue(mockStationResult(stationFixture));
      mockOrganizationsUsage.mockReturnValue(mockStationResult(usageFixture));
      render(<PortalHeaderMeta stationId="station-1" />);
      expect(screen.getByText("Metered usage")).toBeInTheDocument();
      expect(screen.getByText("12 used · 88 available")).toBeInTheDocument();
      expect(screen.getByText("Expensive usage")).toBeInTheDocument();
      expect(screen.getByText("2 used · 8 available")).toBeInTheDocument();
    });

    it("omits the usage rows until the balance has loaded", () => {
      mockStationsGet.mockReturnValue(mockStationResult(stationFixture));
      // default mock returns { data: undefined }
      render(<PortalHeaderMeta stationId="station-1" />);
      expect(screen.queryByText("Metered usage")).not.toBeInTheDocument();
      expect(screen.queryByText("Expensive usage")).not.toBeInTheDocument();
    });
  });

  describe("Mobile layout", () => {
    beforeEach(() => mockBreakpoint("mobile"));

    it("hides the metadata behind a toggle by default", () => {
      mockStationsGet.mockReturnValue(mockStationResult(stationFixture));
      render(<PortalHeaderMeta stationId="station-1" />);
      const toggle = screen.getByTestId("portal-header-meta-toggle");
      expect(toggle).toHaveTextContent(/show session details/i);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      // unmountOnExit → metadata nodes are not in the DOM while collapsed
      expect(
        screen.queryByTestId("portal-header-station-link")
      ).not.toBeInTheDocument();
    });

    it("expands to reveal the metadata when the toggle is clicked", () => {
      mockStationsGet.mockReturnValue(mockStationResult(stationFixture));
      render(<PortalHeaderMeta stationId="station-1" />);
      const toggle = screen.getByTestId("portal-header-meta-toggle");
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveTextContent(/hide session details/i);
      expect(
        screen.getByTestId("portal-header-station-link")
      ).toBeInTheDocument();
      expect(screen.getByText("My CRM")).toBeInTheDocument();
    });

    it("collapses again on a second toggle click", () => {
      mockStationsGet.mockReturnValue(mockStationResult(stationFixture));
      render(<PortalHeaderMeta stationId="station-1" />);
      const toggle = screen.getByTestId("portal-header-meta-toggle");
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    });

    it("keeps usage visible while the session details stay collapsed", () => {
      mockStationsGet.mockReturnValue(mockStationResult(stationFixture));
      mockOrganizationsUsage.mockReturnValue(mockStationResult(usageFixture));
      render(<PortalHeaderMeta stationId="station-1" />);
      // Session details are behind the (collapsed) toggle...
      expect(
        screen.queryByTestId("portal-header-station-link")
      ).not.toBeInTheDocument();
      // ...but usage sits above it and is always visible.
      expect(screen.getByText("12 used · 88 available")).toBeInTheDocument();
      expect(screen.getByText("2 used · 8 available")).toBeInTheDocument();
    });
  });
});
