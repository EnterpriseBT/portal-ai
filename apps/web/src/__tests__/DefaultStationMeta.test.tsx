import { jest } from "@jest/globals";

/**
 * #1041: the org's `defaultStationId` can outlive the station for this viewer:
 * deleted in another tab or by another member, or never shared with them (an
 * unreadable station answers 404 like a missing one). The picker then shows
 * no default, not "Station not found".
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

const mockOrgCurrent = jest.fn();
const mockStationsGet = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    organizations: { current: mockOrgCurrent },
    stations: { get: mockStationsGet },
  },
  queryKeys: {},
}));

const { render, screen, expectNoAxeViolations } = await import("./test-utils");
const { DefaultStationMeta } =
  await import("../components/DefaultStationMeta.component");

const notFound = Object.assign(new Error("Station not found"), {
  status: 404,
  code: "STATION_NOT_FOUND",
});

describe("DefaultStationMeta", () => {
  beforeEach(() => {
    mockOrgCurrent.mockReset();
    mockStationsGet.mockReset();
    mockOrgCurrent.mockReturnValue(
      result({ organization: { id: "org-1", defaultStationId: "st-1" } })
    );
  });

  it("links the default station by name", async () => {
    mockStationsGet.mockReturnValue(
      result({ station: { id: "st-1", name: "Administrate" } })
    );
    const { container } = render(<DefaultStationMeta />);
    expect(screen.getByText("Default Station")).toBeInTheDocument();
    expect(
      await screen.findByRole("link", { name: "Administrate" })
    ).toHaveAttribute("href", "/stations/st-1");
    await expectNoAxeViolations(container);
  });

  it("renders nothing when the org has no default", () => {
    mockOrgCurrent.mockReturnValue(
      result({ organization: { id: "org-1", defaultStationId: null } })
    );
    render(<DefaultStationMeta />);
    expect(screen.queryByText("Default Station")).not.toBeInTheDocument();
    expect(mockStationsGet).not.toHaveBeenCalled();
  });

  it("renders nothing when the default station is gone for this viewer", () => {
    mockStationsGet.mockReturnValue(failed(notFound));
    render(<DefaultStationMeta />);
    expect(screen.queryByText("Default Station")).not.toBeInTheDocument();
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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
    render(<DefaultStationMeta />);
    expect(screen.getByText("Default Station")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
