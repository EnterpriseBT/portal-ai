import { jest } from "@jest/globals";

import type { ActionGate } from "@portalai/core/ui";

type Station = { id: string; name: string };

let mockLastPortalStationId: string | undefined;
let mockReadable: Record<string, Station>;
let mockFavorites: Station[];
let mockGate: ActionGate;
let mockCreateError: { message: string; code: string } | null;
const mockMutate = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    stations: {
      get: (id: string, _params?: unknown, options?: { enabled?: boolean }) => {
        if (options?.enabled === false)
          return { data: undefined, isPending: true };
        const station = mockReadable[id];
        return station
          ? { data: { station }, isPending: false, isError: false }
          : { data: undefined, isPending: false, isError: true };
      },
      list: (params?: { favorite?: string }) => ({
        data: {
          stations: params?.favorite
            ? mockFavorites
            : Object.values(mockReadable),
          total: 0,
        },
        isPending: false,
        isLoading: false,
      }),
    },
    portals: {
      list: () => ({
        data: {
          portals: mockLastPortalStationId
            ? [{ id: "portal-0", stationId: mockLastPortalStationId }]
            : [],
        },
        isPending: false,
      }),
      create: () => ({
        mutate: mockMutate,
        reset: jest.fn(),
        isPending: false,
        error: mockCreateError,
      }),
    },
  },
  queryKeys: { portals: { root: ["portals"] } },
}));

jest.unstable_mockModule("../utils/use-create-gate.util", () => ({
  useCreateGate: () => mockGate,
}));

const { expectNoAxeViolations, render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { NewPortalButton } =
  await import("../components/NewPortalButton.component");

beforeEach(() => {
  mockLastPortalStationId = "s-last";
  mockReadable = {
    "s-last": { id: "s-last", name: "Ops" },
    "s-fav": { id: "s-fav", name: "Finance" },
  };
  mockFavorites = [{ id: "s-fav", name: "Finance" }];
  mockGate = { kind: "allow" };
  mockCreateError = null;
  mockMutate.mockReset();
});

const openMenu = async () => {
  await userEvent.click(
    screen.getByRole("button", { name: "More ways to start a portal" })
  );
  return screen.findByRole("menu");
};

describe("NewPortalButton (#1075)", () => {
  it("starts a portal in the last-used station, refreshing portals and toasting a failure", async () => {
    render(<NewPortalButton />);
    await userEvent.click(
      screen.getByRole("button", { name: /^New portal in Ops$/ })
    );
    expect(mockMutate).toHaveBeenCalledWith(
      { stationId: "s-last" },
      expect.objectContaining({
        invalidate: [["portals"]],
        toast: { error: "Couldn't start the portal." },
      })
    );
  });

  it("falls back to a favorite when the last-used station can't be read", () => {
    delete mockReadable["s-last"];
    render(<NewPortalButton />);
    expect(
      screen.getByRole("button", { name: /^New portal in Finance$/ })
    ).toBeInTheDocument();
  });

  it("chooses a station when there's none to use", async () => {
    mockLastPortalStationId = undefined;
    mockFavorites = [];
    render(<NewPortalButton />);
    await userEvent.click(screen.getByRole("button", { name: /^New portal$/ }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("starts a portal in a favorite from the menu", async () => {
    const { baseElement } = render(<NewPortalButton />);
    await openMenu();
    await expectNoAxeViolations(baseElement);
    await userEvent.click(screen.getByRole("menuitem", { name: "Finance" }));
    expect(mockMutate).toHaveBeenCalledWith(
      { stationId: "s-fav" },
      expect.anything()
    );
  });

  it("shows a Choose station failure in the dialog", async () => {
    mockCreateError = {
      message: "Station not found",
      code: "STATION_NOT_FOUND",
    };
    render(<NewPortalButton />);
    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Choose station…" })
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Station not found");
  });

  it("blocks every launch for a caller who may not start portals", async () => {
    mockGate = { kind: "disable", reason: "Ask for access to start portals" };
    render(<NewPortalButton />);
    const main = screen.getByRole("button", { name: /^New portal in Ops$/ });
    expect(main).toHaveAccessibleDescription("Ask for access to start portals");
    await userEvent.click(main);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Finance" }));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("is hidden from a caller who can't see portals", () => {
    mockGate = { kind: "hide" };
    render(<NewPortalButton />);
    expect(screen.queryByRole("button", { name: /New portal/ })).toBeNull();
  });
});
