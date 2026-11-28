import { jest } from "@jest/globals";

import type { ActionGate } from "@portalai/core/ui";

type Station = { id: string; name: string };

const NOT_FOUND = { status: 404, code: "STATION_NOT_FOUND", message: "Gone" };

let mockLastPortalStationId: string | undefined;
let mockReadable: Record<string, Station>;
// A station that 404'd on a refetch, React Query keeping its old row.
let mockStale: Record<string, Station>;
let mockFavorites: Station[];
let mockFavoritesPending: boolean;
let mockGate: ActionGate;
let mockCreateError: { message: string; code: string } | null;
const mockMutate = jest.fn();
const mockCreateHook = jest.fn();
const mockReset = jest.fn();
const mockPortalsList = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    stations: {
      get: (id: string, _params?: unknown, options?: { enabled?: boolean }) => {
        if (options?.enabled === false) {
          return { data: undefined, isPending: true, error: null };
        }
        if (mockStale[id]) {
          return {
            data: { station: mockStale[id] },
            isPending: false,
            error: NOT_FOUND,
          };
        }
        const station = mockReadable[id];
        return station
          ? { data: { station }, isPending: false, error: null }
          : { data: undefined, isPending: false, error: NOT_FOUND };
      },
      list: (params?: { favorite?: string }) => {
        if (params?.favorite && mockFavoritesPending) {
          return { data: undefined, isPending: true, isLoading: true };
        }
        return {
          data: {
            stations: params?.favorite
              ? mockFavorites
              : Object.values(mockReadable),
            total: 0,
          },
          isPending: false,
          isLoading: false,
        };
      },
    },
    portals: {
      list: (params: unknown) => {
        mockPortalsList(params);
        return {
          data: {
            portals: mockLastPortalStationId
              ? [{ id: "portal-0", stationId: mockLastPortalStationId }]
              : [],
          },
          isPending: false,
        };
      },
      create: () => {
        mockCreateHook();
        return {
          // The launcher creates through mutateAsync; the request never
          // settles here.
          mutateAsync: (...args: unknown[]) => {
            mockMutate(...args);
            return new Promise(() => {});
          },
          reset: mockReset,
          isPending: false,
          error: mockCreateError,
        };
      },
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
const { PortalLauncherProvider } =
  await import("../providers/PortalLauncher.provider");
const { usePortalLauncherContext } =
  await import("../utils/portal-launcher.context");

/** #1076: the button reads the shell's one launcher. */
const Button = () => (
  <PortalLauncherProvider>
    <NewPortalButton />
  </PortalLauncherProvider>
);

beforeEach(() => {
  mockLastPortalStationId = "s-last";
  mockReadable = {
    "s-last": { id: "s-last", name: "Ops" },
    "s-fav": { id: "s-fav", name: "Finance" },
  };
  mockStale = {};
  mockFavorites = [{ id: "s-fav", name: "Finance" }];
  mockFavoritesPending = false;
  mockGate = { kind: "allow" };
  mockCreateError = null;
  mockMutate.mockReset();
  mockReset.mockReset();
  mockPortalsList.mockReset();
});

const openMenu = async () => {
  await userEvent.click(
    screen.getByRole("button", { name: "More ways to start a portal" })
  );
  return screen.findByRole("menu");
};

describe("NewPortalButton (#1075)", () => {
  it("starts a portal in the last-used station, refreshing portals and toasting a failure", async () => {
    render(<Button />);
    await userEvent.click(
      screen.getByRole("button", { name: /^Open Portal in Ops$/ })
    );
    expect(mockMutate).toHaveBeenCalledWith(
      { stationId: "s-last" },
      expect.objectContaining({
        invalidate: [["portals"]],
        toast: { error: "Couldn't start the portal." },
      })
    );
  });

  it("reads the caller's own last portal, without joining its station", () => {
    render(<Button />);
    expect(mockPortalsList).toHaveBeenCalledWith(
      expect.objectContaining({ mine: "true", limit: 5, sortBy: "lastOpened" })
    );
    expect(mockPortalsList.mock.calls[0][0]).not.toHaveProperty("include");
  });

  it("falls back to a favorite when the last-used station can't be read", () => {
    delete mockReadable["s-last"];
    render(<Button />);
    expect(
      screen.getByRole("button", { name: /^Open Portal in Finance$/ })
    ).toBeInTheDocument();
  });

  it("drops a last-used station that 404'd on a refetch, though its old row is cached", () => {
    mockStale = { "s-last": { id: "s-last", name: "Ops" } };
    render(<Button />);
    expect(
      screen.getByRole("button", { name: /^Open Portal in Finance$/ })
    ).toBeInTheDocument();
  });

  it("waits, rather than choosing, while its station is worked out", async () => {
    mockLastPortalStationId = undefined;
    mockFavoritesPending = true;
    render(<Button />);
    const main = screen.getByRole("button", { name: /^Open Portal$/ });
    expect(main).toHaveAccessibleDescription("Finding your station…");
    await userEvent.click(main);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("chooses a station when there's none to use", async () => {
    mockLastPortalStationId = undefined;
    mockFavorites = [];
    render(<Button />);
    await userEvent.click(
      screen.getByRole("button", { name: /^Open Portal$/ })
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // Opening clears any failure from another path.
    expect(mockReset).toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("starts a portal in a favorite from the menu", async () => {
    const { baseElement } = render(<Button />);
    await openMenu();
    await expectNoAxeViolations(baseElement);
    await userEvent.click(screen.getByRole("menuitem", { name: "Finance" }));
    expect(mockMutate).toHaveBeenCalledWith(
      { stationId: "s-fav" },
      expect.anything()
    );
  });

  it("shows a Choose station failure in the dialog, not as a toast", async () => {
    mockCreateError = {
      message: "Station not found",
      code: "STATION_NOT_FOUND",
    };
    render(<Button />);
    // The failure isn't the dialog's until it's open.
    expect(screen.queryByText("Station not found")).toBeNull();
    await openMenu();
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Choose station…" })
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Station not found");
  });

  it("blocks every launch for a caller who may not start portals", async () => {
    mockGate = { kind: "disable", reason: "Ask for access to start portals" };
    render(<Button />);
    const main = screen.getByRole("button", { name: /^Open Portal in Ops$/ });
    expect(main).toHaveAccessibleDescription("Ask for access to start portals");
    await userEvent.click(main);
    await openMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "Finance" }));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("is hidden from a caller who can't see portals", () => {
    mockGate = { kind: "hide" };
    render(<Button />);
    expect(screen.queryByRole("button", { name: /Open Portal/ })).toBeNull();
  });
});

describe("NewPortalButton and the shared launcher (#1076)", () => {
  it("serves the button and another consumer from one launcher", async () => {
    const Other = () => {
      const launcher = usePortalLauncherContext();
      return (
        <button type="button" onClick={() => launcher.launch("s-fav")}>
          Other launch
        </button>
      );
    };
    mockCreateHook.mockClear();
    render(
      <PortalLauncherProvider>
        <NewPortalButton />
        <Other />
      </PortalLauncherProvider>
    );
    await screen.findByRole("button", { name: "Open Portal in Ops" });
    const hooksPerRender = mockCreateHook.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Other launch" }));
    expect(mockMutate).toHaveBeenCalledWith(
      { stationId: "s-fav" },
      expect.anything()
    );
    // One launcher: two consumers never double the create hook.
    expect(hooksPerRender).toBeGreaterThan(0);
  });

  it("can't be used outside the provider", () => {
    const Lone = () => {
      usePortalLauncherContext();
      return null;
    };
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Lone />)).toThrow(/PortalLauncherProvider/);
    spy.mockRestore();
  });
});
