import { jest } from "@jest/globals";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// The container reads rows from the SDK for handle-backed content and drives
// its freshness from useWidgetRefresh — both mocked so these cases stay at the
// module boundary (no auth, no react-query provider).
const mockHandleSnapshot = jest.fn<(...a: unknown[]) => unknown>();
jest.unstable_mockModule("../../../api/sdk", () => ({
  sdk: { portalSql: { handleSnapshot: mockHandleSnapshot } },
  queryKeys: {},
}));

const mockUseWidgetRefresh = jest.fn<(...a: unknown[]) => unknown>();
jest.unstable_mockModule("../../../utils/use-widget-refresh.util", () => ({
  useWidgetRefresh: mockUseWidgetRefresh,
}));

const { TableWidget, TableWidgetUI } = await import("../TableWidget.component");

const REFRESH_IDLE = {
  fresh: null,
  isRefreshing: false,
  error: null,
  notRefreshable: false,
  lastUpdatedAt: null,
  refresh: jest.fn(),
};

const rows = [
  { name: "North Ridge", acres: 412 },
  { name: "Cedar Flat", acres: 388 },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockUseWidgetRefresh.mockReturnValue({ ...REFRESH_IDLE });
  mockHandleSnapshot.mockReturnValue({
    data: { rows },
    isLoading: false,
    error: null,
  });
});

// ── Pure UI ──────────────────────────────────────────────────────────

describe("TableWidgetUI", () => {
  it("renders columns and rows", () => {
    render(<TableWidgetUI columns={["name", "acres"]} rows={rows} />);
    expect(screen.getByText("North Ridge")).toBeInTheDocument();
    expect(screen.getByText("412")).toBeInTheDocument();
  });

  it("renders the freshness cue and refresh button", () => {
    const onRefresh = jest.fn();
    render(
      <TableWidgetUI
        columns={["name"]}
        rows={rows}
        lastUpdatedAt={Date.now()}
        canRefresh
        onRefresh={onRefresh}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh table" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("renders the degraded chip while keeping the rows on screen", () => {
    render(
      <TableWidgetUI
        columns={["name"]}
        rows={rows}
        lastUpdatedAt={Date.now() - 60_000}
        canRefresh
        degraded
        onRefresh={jest.fn()}
      />
    );
    expect(screen.getByTestId("widget-freshness-degraded")).toBeInTheDocument();
    expect(screen.getByText("North Ridge")).toBeInTheDocument();
  });

  it("renders the cue with no refresh button when notRefreshable", () => {
    render(
      <TableWidgetUI
        columns={["name"]}
        rows={rows}
        lastUpdatedAt={Date.now()}
        canRefresh
        notRefreshable
        onRefresh={jest.fn()}
      />
    );
    expect(screen.getByTestId("widget-freshness-updated")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh table" })).toBeNull();
  });

  it("renders the row-cap notice when fewer rows arrived than matched", () => {
    render(
      <TableWidgetUI
        columns={["name"]}
        rows={rows}
        rowCount={50_000}
        matchedCount={50_000}
        matchedCountExact
      />
    );
    const notice = screen.getByTestId("query-result-row-cap-notice");
    expect(notice).toHaveTextContent(/Showing the first 2 of 50,000 rows/);
    // The three load-bearing clauses from #277 survive the move.
    expect(notice).toHaveTextContent(/sort and search only cover/);
    expect(notice).toHaveTextContent(/ask for it in the query/);
  });

  it("renders no row-cap notice when every row is present", () => {
    render(<TableWidgetUI columns={["name"]} rows={rows} rowCount={2} />);
    expect(screen.queryByTestId("query-result-row-cap-notice")).toBeNull();
  });

  it("renders the codegen-fallback message when present", () => {
    render(
      <TableWidgetUI
        columns={["name"]}
        rows={rows}
        message="Couldn't generate the visualization; showing the query result as a table."
      />
    );
    expect(screen.getByTestId("table-widget-message")).toHaveTextContent(
      /Couldn't generate/
    );
  });

  it("renders an error instead of the table", () => {
    render(<TableWidgetUI columns={[]} rows={[]} error="handle expired" />);
    expect(screen.getByTestId("table-widget-error")).toHaveTextContent(
      "handle expired"
    );
  });

  it("renders a loading state", () => {
    render(<TableWidgetUI columns={[]} rows={[]} loading rowCount={9} />);
    expect(screen.getByTestId("table-widget-loading")).toBeInTheDocument();
  });

  /**
   * The sharpest hazard in #349. `QueryResultDataBlockUI` rendered its rows by
   * constructing a synthetic data-table block and re-entering
   * `ContentBlockRenderer` — and once `data-table` resolves to TableWidget,
   * that path is infinite recursion. TableWidgetUI must call DataTableBlock
   * directly. Rendering it inside a registry where `data-table` maps back to
   * TableWidget would blow the stack if it ever regressed.
   */
  it("does not re-enter the block renderer registry", async () => {
    const { registerBlockRenderer } = await import("@portalai/core");
    registerBlockRenderer("data-table", () => (
      <TableWidgetUI columns={["name"]} rows={rows} />
    ));
    expect(() =>
      render(<TableWidgetUI columns={["name"]} rows={rows} />)
    ).not.toThrow();
    expect(screen.getAllByText("North Ridge").length).toBeGreaterThan(0);
  });
});

// ── Container ────────────────────────────────────────────────────────

describe("TableWidget", () => {
  // Hooks can't be conditional, so the query is always constructed — what
  // matters is that it is DISABLED, so an inline table issues no request.
  it("renders inline content without issuing a snapshot request", () => {
    render(
      <TableWidget
        content={{ type: "data-table", columns: ["name", "acres"], rows }}
      />
    );
    expect(screen.getByText("North Ridge")).toBeInTheDocument();
    expect(mockHandleSnapshot).toHaveBeenCalledWith(
      "",
      expect.anything(),
      expect.objectContaining({ enabled: false })
    );
  });

  it("fetches the snapshot for handle-backed content", async () => {
    render(
      <TableWidget
        content={{
          type: "data-table",
          queryHandle: "qh-1",
          rowCount: 2,
          schema: [],
          samplePeek: [],
          sampled: false,
          truncated: false,
          sql: null,
        }}
      />
    );
    await waitFor(() =>
      expect(mockHandleSnapshot).toHaveBeenCalledWith(
        "qh-1",
        expect.anything(),
        expect.objectContaining({ enabled: true })
      )
    );
    expect(screen.getByText("North Ridge")).toBeInTheDocument();
  });

  it("derives columns from the rows when content carries none", () => {
    render(<TableWidget content={{ type: "data-table", rows }} />);
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("acres")).toBeInTheDocument();
  });

  it("shows the degraded chip on a refresh error, keeping the previous rows", () => {
    mockUseWidgetRefresh.mockReturnValue({
      ...REFRESH_IDLE,
      error: { message: "rate limited", code: "VIZ_REFRESH_RATE_LIMITED" },
      lastUpdatedAt: Date.now() - 60_000,
    });
    render(
      <TableWidget
        content={{ type: "data-table", columns: ["name"], rows }}
        blockRef={{ kind: "message", messageId: "m1", blockIndex: 0 }}
      />
    );
    expect(screen.getByTestId("widget-freshness-degraded")).toBeInTheDocument();
    expect(screen.getByText("North Ridge")).toBeInTheDocument();
  });

  it("renders no refresh button when the block is notRefreshable", () => {
    mockUseWidgetRefresh.mockReturnValue({
      ...REFRESH_IDLE,
      notRefreshable: true,
      lastUpdatedAt: Date.now(),
    });
    render(
      <TableWidget
        content={{ type: "data-table", columns: ["name"], rows }}
        blockRef={{ kind: "message", messageId: "m1", blockIndex: 0 }}
      />
    );
    expect(screen.getByTestId("widget-freshness-updated")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh table" })).toBeNull();
  });

  it("prefers a fresh inline delivery over the block's baked rows", () => {
    mockUseWidgetRefresh.mockReturnValue({
      ...REFRESH_IDLE,
      fresh: { kind: "inline", rows: [{ name: "New Burn", acres: 902 }] },
      lastUpdatedAt: Date.now(),
    });
    render(
      <TableWidget
        content={{ type: "data-table", columns: ["name", "acres"], rows }}
        blockRef={{ kind: "message", messageId: "m1", blockIndex: 0 }}
      />
    );
    expect(screen.getByText("New Burn")).toBeInTheDocument();
    expect(screen.queryByText("North Ridge")).toBeNull();
  });

  it("offers no refresh affordance without a blockRef (streaming block)", () => {
    render(
      <TableWidget content={{ type: "data-table", columns: ["name"], rows }} />
    );
    expect(screen.queryByRole("button", { name: "Refresh table" })).toBeNull();
  });
});
