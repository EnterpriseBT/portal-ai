import { jest } from "@jest/globals";
import type { PortalResult } from "@portalai/core/models";
import type { UseMutationResult } from "@tanstack/react-query";

// ── Mocks (container tests, #286) ────────────────────────────────────

const mockRemove = jest.fn<(vars: { id: string }) => Promise<unknown>>();
const mockRename = jest.fn();
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
