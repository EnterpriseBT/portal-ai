import { jest } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockStationsGet = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    stations: { get: mockStationsGet },
  },
  queryKeys: {},
}));

const { render, screen, fireEvent } = await import("./test-utils");
const { PortalHeaderMeta } = await import("../views/Portal.view");

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
    toolPacks: ["data_query", "statistics"],
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
      },
      {
        id: "si-2",
        stationId: "station-1",
        connectorInstanceId: "ci-2",
        connectorInstance: { id: "ci-2", name: "My CSV" },
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

// ── Tests ────────────────────────────────────────────────────────────

describe("PortalHeaderMeta", () => {
  beforeEach(() => {
    mockStationsGet.mockReset();
    resetMatchMedia();
  });

  afterEach(() => {
    resetMatchMedia();
  });

  it("renders nothing until the station query resolves", () => {
    mockStationsGet.mockReturnValue(mockStationResult(undefined));
    const { container } = render(<PortalHeaderMeta stationId="station-1" />);
    expect(container.firstChild).toBeNull();
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
      expect(screen.queryByTestId("portal-header-meta-toggle")).not.toBeInTheDocument();
    });

    it("hides the Connectors section when the station has no instances", () => {
      const bare = {
        ...stationFixture,
        station: { ...stationFixture.station, instances: [] },
      };
      mockStationsGet.mockReturnValue(mockStationResult(bare));
      render(<PortalHeaderMeta stationId="station-1" />);
      expect(screen.queryByText("Connectors")).not.toBeInTheDocument();
    });

    it("hides the Tool Packs section when the station has none", () => {
      const bare = {
        ...stationFixture,
        station: { ...stationFixture.station, toolPacks: [] },
      };
      mockStationsGet.mockReturnValue(mockStationResult(bare));
      render(<PortalHeaderMeta stationId="station-1" />);
      expect(screen.queryByText("Tool Packs")).not.toBeInTheDocument();
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
      expect(screen.queryByTestId("portal-header-station-link")).not.toBeInTheDocument();
    });

    it("expands to reveal the metadata when the toggle is clicked", () => {
      mockStationsGet.mockReturnValue(mockStationResult(stationFixture));
      render(<PortalHeaderMeta stationId="station-1" />);
      const toggle = screen.getByTestId("portal-header-meta-toggle");
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveTextContent(/hide session details/i);
      expect(screen.getByTestId("portal-header-station-link")).toBeInTheDocument();
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
  });
});
