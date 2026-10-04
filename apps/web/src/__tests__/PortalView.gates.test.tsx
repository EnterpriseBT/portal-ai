/**
 * #690: the portal page renders Rename and Delete from the portal's own
 * `capabilities`, and records `lastOpened` only when the caller may write it.
 */
import { jest } from "@jest/globals";

const mockPortalsGet = jest.fn();
const mockTouchMutate = jest.fn();
const mutation = () => ({ mutate: jest.fn(), isPending: false, error: null });
const loading = () => ({
  data: undefined,
  isLoading: true,
  isError: false,
  isSuccess: false,
  error: null,
});

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    portals: {
      get: mockPortalsGet,
      rename: mutation,
      remove: mutation,
      touch: () => ({ mutate: mockTouchMutate, isPending: false }),
    },
    stations: { get: loading },
    organizations: { usage: loading },
    toolpacks: { list: loading },
  },
  queryKeys: {
    portals: { root: ["portals"] },
    portalResults: { root: ["pr"] },
  },
}));

jest.unstable_mockModule("../components/PortalSession.component", () => ({
  PortalSession: () => <div data-testid="portal-session" />,
}));

const { render, screen } = await import("./test-utils");
const { PortalView } = await import("../views/Portal.view");

const portalResult = (capabilities: {
  read: boolean;
  write: boolean;
  delete: boolean;
}) => ({
  data: {
    portal: {
      id: "portal-1",
      organizationId: "org-1",
      stationId: "station-1",
      name: "Sales Analysis",
      created: Date.now(),
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      lastOpened: null,
      capabilities,
    },
    messages: [],
  },
  isLoading: false,
  isError: false,
  isSuccess: true,
  error: null,
});

beforeEach(() => {
  mockPortalsGet.mockReset();
  mockTouchMutate.mockReset();
});

describe("PortalView gates (#690)", () => {
  it("shows Rename and Delete, and records lastOpened, with write and delete", async () => {
    mockPortalsGet.mockReturnValue(
      portalResult({ read: true, write: true, delete: true })
    );
    render(<PortalView portalId="portal-1" />);
    expect(
      await screen.findByRole("button", { name: /Rename/ })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "More actions" })
    ).toBeInTheDocument();
    expect(mockTouchMutate).toHaveBeenCalledTimes(1);
  });

  it("a read-only caller sees no Rename or Delete, and nothing is written", async () => {
    mockPortalsGet.mockReturnValue(
      portalResult({ read: true, write: false, delete: false })
    );
    render(<PortalView portalId="portal-1" />);
    expect(await screen.findByText("Sales Analysis")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rename/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
    expect(mockTouchMutate).not.toHaveBeenCalled();
  });

  it("doesn't record lastOpened before the capabilities are known", () => {
    mockPortalsGet.mockReturnValue(loading());
    render(<PortalView portalId="portal-1" />);
    expect(mockTouchMutate).not.toHaveBeenCalled();
  });
});
