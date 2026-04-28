import { jest } from "@jest/globals";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PortalResult } from "@portalai/core/models";
import type { PortalResultsListPayload } from "../api/portal-results.api";
import type { ApiError } from "../utils";

type ListQuery = UseQueryResult<PortalResultsListPayload, ApiError>;

let currentListQuery: Partial<ListQuery> = {};

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    portalResults: {
      list: () => currentListQuery,
    },
  },
  queryKeys: {
    portalResults: {
      root: ["portalResults"],
      list: () => ["portalResults", "list"],
    },
  },
}));

jest.unstable_mockModule("../utils/api.util", () => ({
  useAuthFetch: () => ({
    fetchWithAuth: jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue(undefined),
  }),
  useAuthQuery: jest.fn(),
  useAuthMutation: jest.fn(),
  resolveApiUrl: (path: string) => path,
}));

const { render, screen } = await import("./test-utils");
const { PinnedResultsListView } =
  await import("../views/PinnedResultsListView.view");

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
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  ...overrides,
});

describe("PinnedResultsListView", () => {
  beforeEach(() => {
    currentListQuery = {};
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
      name: "Sales Chart",
      type: "vega-lite",
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
    expect(screen.getByText("Sales Chart")).toBeInTheDocument();
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
