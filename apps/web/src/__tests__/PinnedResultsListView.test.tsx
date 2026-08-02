import { jest } from "@jest/globals";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PortalResult } from "@portalai/core/models";
import type { PortalResultsListPayload } from "../api/portal-results.api";
import type { ApiError } from "../utils";

type ListQuery = UseQueryResult<PortalResultsListPayload, ApiError>;

let currentListQuery: Partial<ListQuery> = {};
const mockRemove = jest.fn<(vars: { id: string }) => Promise<unknown>>();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    portalResults: {
      list: () => currentListQuery,
      // #312 (closes the UNPIN_SDK_BYPASS remainder): unpin routes through
      // the SDK here too.
      remove: () => ({ mutateAsync: mockRemove, isPending: false }),
    },
  },
  queryKeys: {
    portalResults: {
      root: ["portalResults"],
      list: () => ["portalResults", "list"],
    },
  },
}));

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { QueryClient } = await import("@tanstack/react-query");
const { ToastContext } = await import("../utils/toast.context");
const { PinnedResultsListView } =
  await import("../views/PinnedResultsListView.view");

const mockToast = {
  success: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  error:
    jest.fn<
      (
        msg: string,
        opts?: { action?: { label: string; onClick: () => void } }
      ) => void
    >(),
  show: jest.fn(),
  dismiss: jest.fn(),
  dismissAll: jest.fn(),
};

const makePinnedResult = (
  overrides: Partial<PortalResult> = {}
): PortalResult => ({
  id: "result-1",
  organizationId: "org-1",
  stationId: "station-1",
  portalId: "portal-1",
  messageId: null,
  blockIndex: null,
  name: "Revenue Summary",
  type: "text",
  content: { text: "Total revenue: $1.2M" },
  created: Date.now() - 3600000,
  createdBy: "user-1",
  snapshotUpdatedAt: null,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  ...overrides,
});

describe("PinnedResultsListView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentListQuery = {};
    mockRemove.mockReset().mockResolvedValue(undefined);
  });

  // ── #312: unpin through the SDK ────────────────────────────────────

  const renderWithResult = () => {
    currentListQuery = {
      data: {
        portalResults: [makePinnedResult({ id: "r-1", name: "Revenue" })],
        total: 1,
        limit: 20,
        offset: 0,
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
    render(
      <ToastContext.Provider value={mockToast}>
        <PinnedResultsListView />
      </ToastContext.Provider>,
      { queryClient }
    );
    return { invalidateSpy };
  };

  it("routes unpin through the SDK mutation and invalidates the root", async () => {
    const { invalidateSpy } = renderWithResult();

    fireEvent.click(screen.getByRole("button", { name: "Unpin" }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith({ id: "r-1" }));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["portalResults"],
      })
    );
  });

  it("raises an error toast when the unpin fails", async () => {
    mockRemove.mockRejectedValue(new Error("boom"));
    const { invalidateSpy } = renderWithResult();

    fireEvent.click(screen.getByRole("button", { name: "Unpin" }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledTimes(1));
    expect(mockToast.error.mock.calls[0][0]).toMatch(/could not remove/i);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("should display the Pinned Results heading", () => {
    currentListQuery = {
      data: { portalResults: [], total: 0, limit: 20, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<PinnedResultsListView />);
    expect(
      screen.getByRole("heading", { name: "Pinned Results" })
    ).toBeInTheDocument();
  });

  it("should display empty results when no pinned results exist", () => {
    currentListQuery = {
      data: { portalResults: [], total: 0, limit: 20, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<PinnedResultsListView />);
    expect(screen.getByText("No pinned results")).toBeInTheDocument();
  });

  it("should display pinned result cards when results exist", () => {
    const result1 = makePinnedResult({ id: "r-1", name: "Revenue Summary" });
    const result2 = makePinnedResult({
      id: "r-2",
      name: "Sales Table",
      type: "data-table",
    });

    currentListQuery = {
      data: {
        portalResults: [result1, result2],
        total: 2,
        limit: 20,
        offset: 0,
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<PinnedResultsListView />);
    expect(screen.getByText("Revenue Summary")).toBeInTheDocument();
    expect(screen.getByText("Sales Table")).toBeInTheDocument();
  });

  it("should show loading state", () => {
    currentListQuery = {
      data: undefined,
      isLoading: true,
      isError: false,
      isSuccess: false,
      error: null,
    } as Partial<ListQuery>;

    render(<PinnedResultsListView />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("should render breadcrumbs with Dashboard link", () => {
    currentListQuery = {
      data: { portalResults: [], total: 0, limit: 20, offset: 0 },
      isLoading: false,
      isError: false,
      isSuccess: true,
    } as Partial<ListQuery>;

    render(<PinnedResultsListView />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    // "Pinned Results" appears in both breadcrumb and heading
    expect(screen.getAllByText("Pinned Results").length).toBeGreaterThanOrEqual(
      2
    );
  });
});
