import { jest } from "@jest/globals";

/**
 * #1041: the dashboard card reads the org's `defaultStationId` and fetches
 * that station. When the station is gone for this viewer (deleted elsewhere,
 * or not shared with them) the card shows what it shows for an org with no
 * default, not an error.
 */

const result = (data: unknown) => ({
  data,
  isLoading: false,
  isError: false,
  isSuccess: true,
  error: null,
});
const failed = (error: unknown) => ({
  data: undefined,
  isLoading: false,
  isError: true,
  isSuccess: false,
  error,
});

const mockStationsGet = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    organizations: {
      current: () =>
        result({ organization: { id: "org-1", defaultStationId: "st-1" } }),
    },
    stations: { get: mockStationsGet },
    billing: { catalog: () => result(undefined) },
  },
  queryKeys: {},
}));
jest.unstable_mockModule("../utils/use-builtin-entitlements.util", () => ({
  useBuiltinEntitlements: () => ({ entitledSlugs: new Set(["data_query"]) }),
}));

const { render, screen } = await import("./test-utils");
const { DefaultStationCardConnected, DefaultStationCardUI } =
  await import("../components/DefaultStationCard.component");

const props = { onLaunchPortal: jest.fn(), onChangeDefault: jest.fn() };

describe("DefaultStationCardConnected", () => {
  beforeEach(() => mockStationsGet.mockReset());

  it("renders the no-default state when the default station is gone for this viewer", () => {
    mockStationsGet.mockReturnValue(
      failed(
        Object.assign(new Error("Station not found"), {
          status: 404,
          code: "STATION_NOT_FOUND",
        })
      )
    );
    const connected = render(<DefaultStationCardConnected {...props} />);
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Exactly what the card renders for an org with no default station.
    const empty = render(<DefaultStationCardUI station={null} {...props} />);
    expect(connected.container.innerHTML).toBe(empty.container.innerHTML);
  });

  it("still reports any other failure to load it", () => {
    mockStationsGet.mockReturnValue(
      failed(
        Object.assign(new Error("Internal server error"), {
          status: 500,
          code: "STATION_FETCH_FAILED",
        })
      )
    );
    render(<DefaultStationCardConnected {...props} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
