/**
 * #649: the container's wiring when a view goes away under the open page.
 * The records query 404s while the view's own query is still cached; the
 * container must refetch the view so the page reads "View not found", not
 * the view's header over an empty table.
 */
import { jest } from "@jest/globals";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";

const { ApiError } = await import("../utils/api.util");

const view = {
  id: "cv-1",
  organizationId: "org-1",
  connectorEntityId: "ent-1",
  key: "ne_accounts",
  label: "NE Accounts",
  description: null,
  filter: null,
  fieldMappingIds: ["fm-1"],
  filtered: false,
  capabilities: { read: true, write: true, delete: true, share: true },
  projected: true,
  created: Date.now(),
  createdBy: "u1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const notFound = () =>
  new ApiError("Curated view not found", "CURATED_VIEW_NOT_FOUND", 404);

// The view's fetch: succeeds first, then 404s once the view is deleted.
const fetchView = jest.fn<() => Promise<unknown>>();
const fetchRecords = jest.fn<() => Promise<unknown>>();

const idle = { data: undefined, isLoading: false, isError: false, error: null };
const mutation = { mutate: jest.fn(), isPending: false, error: null };

// The SDK's query hooks, over real react-query so invalidation refetches.
const useViewQuery = (id: string) =>
  useQuery({
    queryKey: ["curatedViews", "get", id],
    queryFn: fetchView,
    retry: false,
  });
const useRecordsQuery = (id: string, params: unknown) =>
  useQuery({
    queryKey: ["curatedViews", "records", id, params],
    queryFn: fetchRecords,
    retry: false,
  });

jest.unstable_mockModule("@tanstack/react-router", () => ({
  useParams: () => ({ viewId: "cv-1" }),
  useNavigate: () => jest.fn(),
}));
jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    curatedViews: {
      get: useViewQuery,
      records: useRecordsQuery,
      delete: () => mutation,
      create: () => mutation,
      update: () => mutation,
    },
    connectorEntities: { list: () => idle },
    fieldMappings: { list: () => idle },
    entityRecords: { list: () => idle },
  },
}));

const { render, screen } = await import("@testing-library/react");
const { ThemeProvider } = await import("@portalai/core/ui");
const { CuratedViewDetail } = await import("../views/CuratedViewDetail.view");

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  });
  return render(
    <ThemeProvider defaultTheme="brand">
      <QueryClientProvider client={queryClient}>
        <CuratedViewDetail />
      </QueryClientProvider>
    </ThemeProvider>
  );
};

describe("CuratedViewDetail (container)", () => {
  beforeEach(() => {
    fetchView.mockReset();
    fetchRecords.mockReset();
  });

  it("#649: refetches the view when its records 404, and shows View not found", async () => {
    fetchView
      .mockResolvedValueOnce({ curatedView: view })
      .mockRejectedValue(notFound());
    fetchRecords.mockRejectedValue(notFound());

    renderPage();

    expect(await screen.findByText("View not found")).toBeInTheDocument();
    expect(fetchView).toHaveBeenCalledTimes(2);
    expect(screen.queryAllByText("NE Accounts")).toHaveLength(0);
  });

  it("doesn't refetch the view for a records error that isn't a 404", async () => {
    fetchView.mockResolvedValue({ curatedView: view });
    fetchRecords.mockRejectedValue(
      new ApiError("Internal server error", "CURATED_VIEW_FETCH_FAILED", 500)
    );

    renderPage();

    expect((await screen.findAllByText("NE Accounts")).length).toBeGreaterThan(
      0
    );
    // Let the records error land and its effect run.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchRecords).toHaveBeenCalled();
    expect(fetchView).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("View not found")).not.toBeInTheDocument();
  });
});
