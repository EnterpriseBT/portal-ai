import { jest } from "@jest/globals";
import type { PortalResult } from "@portalai/core/models";
import type { UseMutationResult } from "@tanstack/react-query";

// ── Mocks (container tests, #286) ────────────────────────────────────

const mockRemove = jest.fn<(vars: { id: string }) => Promise<unknown>>();
const mockRename = jest.fn();
const mockPinRefresh = jest.fn<(vars: { id: string }) => Promise<unknown>>();
let currentGetQuery: Record<string, unknown> = {};

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    portalResults: {
      get: () => currentGetQuery,
      rename: () =>
        ({
          mutate: mockRename,
          isPending: false,
        }) as Partial<UseMutationResult>,
      remove: () =>
        ({
          mutateAsync: mockRemove,
          isPending: false,
        }) as Partial<UseMutationResult>,
      refresh: () =>
        ({
          mutateAsync: mockPinRefresh,
        }) as Partial<UseMutationResult>,
    },
    // useWidgetRefresh's message-branch endpoint (unused here, but the hook
    // instantiates both).
    portalSql: {
      widgetRefresh: () => ({ mutateAsync: jest.fn() }),
    },
  },
  queryKeys: {
    portalResults: { root: ["portalResults"], get: (id: string) => ["pr", id] },
  },
}));

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

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { QueryClient } = await import("@tanstack/react-query");
const { ToastContext } = await import("../utils/toast.context");
const { registerBlockRenderer } = await import("@portalai/core");
const { PinnedResultDetailUI, PinnedResultDetailView } =
  await import("../views/PinnedResultDetail.view");

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
  content: { value: "Total revenue: **$1.2M**" },
  created: Date.now() - 3600000,
  createdBy: "user-1",
  snapshotUpdatedAt: null,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  ...overrides,
});

const defaultProps = {
  result: makePinnedResult(),
  onRename: jest.fn(),
  onDelete: jest.fn(),
  onUnpin: jest.fn(),
  onOpenPortal: jest.fn(),
  onNavigate: jest.fn(),
};

describe("PinnedResultDetailUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render result name and type chip", () => {
    render(<PinnedResultDetailUI {...defaultProps} />);
    expect(
      screen.getByRole("heading", { name: "Revenue Summary" })
    ).toBeInTheDocument();
    expect(screen.getByText("Text")).toBeInTheDocument();
  });

  it("should render Table chip for data-table type", () => {
    render(
      <PinnedResultDetailUI
        {...defaultProps}
        result={makePinnedResult({
          type: "data-table",
          content: { columns: ["a"], rows: [{ a: 1 }] },
        })}
      />
    );
    expect(screen.getByText("Table")).toBeInTheDocument();
  });

  // ── #312: durable viz kinds ────────────────────────────────────────

  it("renders Chart / Map chips for d3 / geo types", () => {
    const { unmount } = render(
      <PinnedResultDetailUI
        {...defaultProps}
        result={makePinnedResult({
          type: "d3",
          content: { program: "api.svg;", rows: [] },
        })}
      />
    );
    expect(screen.getByText("Chart")).toBeInTheDocument();
    unmount();

    render(
      <PinnedResultDetailUI
        {...defaultProps}
        result={makePinnedResult({
          type: "geo",
          content: { layers: [] },
        })}
      />
    );
    expect(screen.getByText("Map")).toBeInTheDocument();
  });

  it("threads a pin blockRef + snapshot timestamp to the block renderer", () => {
    registerBlockRenderer("d3", (_b, ctx) => (
      <div data-testid="pin-blockref-stub">
        {ctx?.blockRef?.kind === "pin"
          ? `${ctx.blockRef.portalResultId}:${ctx?.dataUpdatedAt}`
          : "no-pin-ref"}
      </div>
    ));
    render(
      <PinnedResultDetailUI
        {...defaultProps}
        result={makePinnedResult({
          type: "d3",
          content: { program: "api.svg;", rows: [] },
          snapshotUpdatedAt: 424242,
        })}
      />
    );
    expect(screen.getByTestId("pin-blockref-stub")).toHaveTextContent(
      "result-1:424242"
    );
  });

  it("shows an expired-data notice for a legacy snapshot-less pin", () => {
    render(
      <PinnedResultDetailUI
        {...defaultProps}
        result={makePinnedResult({
          type: "data-table",
          content: { queryHandle: "qh-dead", columns: ["a"] },
        })}
      />
    );
    expect(screen.getByTestId("pinned-expired-notice")).toBeInTheDocument();
  });

  it("marks a tombstoned source portal instead of offering the link", () => {
    render(
      <PinnedResultDetailUI
        {...defaultProps}
        result={makePinnedResult({ portalId: null })}
      />
    );
    expect(screen.getByText(/portal deleted/i)).toBeInTheDocument();
  });

  /**
   * #349: the page-level refresh control is gone. It existed only because
   * `data-table` was the one pinnable type without widget-level refresh;
   * now every refreshable type owns its own cue, button, and degraded state
   * via the pin `blockRef`. Keeping both duplicated the chrome and
   * double-fired the mount auto-refresh against the per-org rate cap.
   */
  it("renders no page-level refresh control — the widget owns it", () => {
    render(
      <PinnedResultDetailUI
        {...defaultProps}
        result={makePinnedResult({
          type: "data-table",
          content: { columns: ["a"], rows: [{ a: 1 }] },
        })}
      />
    );
    expect(screen.queryByRole("button", { name: /refresh data/i })).toBeNull();
    expect(screen.queryByTestId("pinned-refresh-error")).toBeNull();
    // The stored snapshot still renders, threaded to the widget below.
    expect(screen.getByTestId("result-content")).toBeInTheDocument();
  });

  it("should render relative created timestamp", () => {
    render(<PinnedResultDetailUI {...defaultProps} />);
    expect(screen.getByText("1h ago")).toBeInTheDocument();
  });

  it("should render text content", () => {
    render(<PinnedResultDetailUI {...defaultProps} />);
    expect(screen.getByTestId("result-content")).toBeInTheDocument();
  });

  it("should render breadcrumbs with Dashboard and Pinned Results links", () => {
    render(<PinnedResultDetailUI {...defaultProps} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Pinned Results")).toBeInTheDocument();
    // "Revenue Summary" appears in both breadcrumb and heading
    expect(
      screen.getAllByText("Revenue Summary").length
    ).toBeGreaterThanOrEqual(2);
  });

  it("should open rename dialog and call onRename on submit", () => {
    const onRename = jest.fn();
    render(<PinnedResultDetailUI {...defaultProps} onRename={onRename} />);

    // Open the actions menu
    fireEvent.click(screen.getByRole("button", { name: /More actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Rename/i }));
    expect(screen.getByText("Rename Result")).toBeInTheDocument();

    const input = screen.getByTestId("rename-input").querySelector("input")!;
    fireEvent.change(input, { target: { value: "Updated Name" } });
    fireEvent.click(screen.getByTestId("rename-submit"));

    expect(onRename).toHaveBeenCalledWith("Updated Name");
  });

  it("should open delete dialog and call onDelete on confirm", () => {
    const onDelete = jest.fn();
    render(<PinnedResultDetailUI {...defaultProps} onDelete={onDelete} />);

    // Open the actions menu
    fireEvent.click(screen.getByRole("button", { name: /More actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/i }));
    expect(screen.getByText("Delete Pinned Result")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("delete-confirm"));
    expect(onDelete).toHaveBeenCalled();
  });

  it("should render Open Source Portal in actions menu when portalId is present", () => {
    render(<PinnedResultDetailUI {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /More actions/i }));
    expect(
      screen.getByRole("menuitem", { name: /Open Source Portal/i })
    ).toBeInTheDocument();
  });

  it("should call onOpenPortal when Open Source Portal is clicked", () => {
    const onOpenPortal = jest.fn();
    render(
      <PinnedResultDetailUI {...defaultProps} onOpenPortal={onOpenPortal} />
    );
    fireEvent.click(screen.getByRole("button", { name: /More actions/i }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Open Source Portal/i })
    );
    expect(onOpenPortal).toHaveBeenCalledWith("portal-1", null);
  });

  it("should pass messageId to onOpenPortal when present on the result", () => {
    const onOpenPortal = jest.fn();
    render(
      <PinnedResultDetailUI
        {...defaultProps}
        result={makePinnedResult({ messageId: "msg-42", blockIndex: 0 })}
        onOpenPortal={onOpenPortal}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /More actions/i }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: /Open Source Portal/i })
    );
    expect(onOpenPortal).toHaveBeenCalledWith("portal-1", "msg-42");
  });

  it("should call onUnpin when Unpin button is clicked", () => {
    const onUnpin = jest.fn();
    render(<PinnedResultDetailUI {...defaultProps} onUnpin={onUnpin} />);
    fireEvent.click(screen.getByTestId("unpin-btn"));
    expect(onUnpin).toHaveBeenCalled();
  });

  it("should not render Open Source Portal button when portalId is null", () => {
    render(
      <PinnedResultDetailUI
        {...defaultProps}
        result={makePinnedResult({ portalId: null })}
      />
    );
    expect(screen.queryByTestId("open-portal-btn")).not.toBeInTheDocument();
  });
});

// ── Container wiring (#286) ───────────────────────────────────────────
//
// "Unpin" and the confirm-dialog "Delete" were two byte-identical
// hand-rolled `fetchWithAuth` calls. Both now route through one handler on
// the SDK mutation, so both paths need container-level coverage.

describe("PinnedResultDetailView container — live refresh (#312)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPinRefresh
      .mockReset()
      .mockResolvedValue({ kind: "inline", rows: [{ a: 2 }] });
  });

  /**
   * #349: the page no longer runs its own `useWidgetRefresh`. A stale pin used
   * to fire the mount auto-refresh TWICE — once page-level, once inside the
   * widget via the same pin `blockRef` — spending two calls of the per-org
   * rate budget for one view. The widget is now the single refresher.
   *
   * Tradeoff recorded: the page-level hook also invalidated the pin's `get`
   * query so the stored row refetched after a refresh. That invalidation is
   * gone. It is not user-visible — the widget renders its own fresh delivery
   * over the stored rows — but the page's cached row stays stale until the
   * next natural refetch.
   */
  it("does not fire a page-level refresh for a stale pin", async () => {
    currentGetQuery = {
      data: {
        portalResult: makePinnedResult({
          id: "result-live-1",
          type: "data-table",
          content: {
            columns: ["a"],
            rows: [{ a: 1 }],
            pipeline: {
              sql: "SELECT a FROM t",
              stationId: "st-1",
              organizationId: "org-1",
            },
          },
          snapshotUpdatedAt: Date.now() - 10 * 60 * 1000, // stale
        }),
      },
      isLoading: false,
      error: null,
    };
    render(
      <ToastContext.Provider value={mockToast}>
        <PinnedResultDetailView portalResultId="result-live-1" />
      </ToastContext.Provider>
    );

    await waitFor(() =>
      expect(screen.getByTestId("result-content")).toBeInTheDocument()
    );
    expect(mockPinRefresh).not.toHaveBeenCalled();
  });

  it("never wires page-level refresh for a pipeline-less pin", async () => {
    currentGetQuery = {
      data: {
        portalResult: makePinnedResult({
          id: "result-static-1",
          type: "data-table",
          content: { columns: ["a"], rows: [{ a: 1 }] },
          snapshotUpdatedAt: Date.now() - 10 * 60 * 1000,
        }),
      },
      isLoading: false,
      error: null,
    };
    render(
      <ToastContext.Provider value={mockToast}>
        <PinnedResultDetailView portalResultId="result-static-1" />
      </ToastContext.Provider>,
      { queryClient: new QueryClient() }
    );

    expect(
      screen.queryByRole("button", { name: /refresh data/i })
    ).not.toBeInTheDocument();
    expect(mockPinRefresh).not.toHaveBeenCalled();
  });
});

describe("PinnedResultDetailView container — remove", () => {
  const renderContainer = () => {
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, "invalidateQueries");
    const utils = render(
      <ToastContext.Provider value={mockToast}>
        <PinnedResultDetailView portalResultId="result-1" />
      </ToastContext.Provider>,
      { queryClient }
    );
    return { ...utils, invalidateSpy };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRemove.mockReset().mockResolvedValue(undefined);
    currentGetQuery = {
      data: { portalResult: makePinnedResult() },
      isLoading: false,
      error: null,
    };
  });

  it("routes Unpin through the SDK mutation", async () => {
    renderContainer();

    fireEvent.click(screen.getByTestId("unpin-btn"));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(1));
    expect(mockRemove).toHaveBeenCalledWith({ id: "result-1" });
  });

  it("routes the Delete confirmation through the same mutation", async () => {
    renderContainer();

    // Delete lives behind the actions menu, then a confirm dialog.
    fireEvent.click(screen.getByRole("button", { name: /More actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/i }));
    fireEvent.click(screen.getByTestId("delete-confirm"));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(1));
    expect(mockRemove).toHaveBeenCalledWith({ id: "result-1" });
  });

  it("invalidates the portal-results root on success", async () => {
    const { invalidateSpy } = renderContainer();

    fireEvent.click(screen.getByTestId("unpin-btn"));

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["portalResults"],
      })
    );
  });

  it("raises an error toast and stays put when the remove fails", async () => {
    mockRemove.mockRejectedValue(new Error("boom"));
    const { invalidateSpy } = renderContainer();

    fireEvent.click(screen.getByTestId("unpin-btn"));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledTimes(1));
    expect(mockToast.error.mock.calls[0][0]).toMatch(/could not remove/i);
    // The result still exists, so no cache churn and no navigation away.
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("unpin-btn")).toBeInTheDocument();
  });

  it("offers Retry on the failure toast", async () => {
    mockRemove.mockRejectedValue(new Error("boom"));
    renderContainer();

    fireEvent.click(screen.getByTestId("unpin-btn"));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());

    const action = mockToast.error.mock.calls[0][1]?.action;
    expect(action?.label).toBe("Retry");

    mockRemove.mockResolvedValue(undefined);
    action?.onClick();
    await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(2));
  });
});
