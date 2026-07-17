import { jest } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockUsageLedger = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    organizations: {
      usageLedger: mockUsageLedger,
    },
  },
}));

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { UsageLedgerDialog, UsageLedgerDialogUI } =
  await import("../components/UsageLedgerDialog.component");

// ── Fixtures ─────────────────────────────────────────────────────────

const entry = (over: Partial<Record<string, unknown>> = {}) => ({
  id: `entry-${Math.random().toString(36).slice(2)}`,
  created: 1_784_000_000_000,
  createdBy: "SYSTEM",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  organizationId: "org-1",
  toolName: "web_search",
  toolCallId: "call_1",
  stationId: "station-1",
  portalId: null,
  costClass: "metered" as const,
  units: 1,
  periodId: "2026-07",
  userId: "user-1",
  ...over,
});

const uiProps = {
  open: true,
  onClose: jest.fn(),
  entries: [] as ReturnType<typeof entry>[],
  total: 0,
  page: 0,
  rowsPerPage: 10,
  onPageChange: jest.fn(),
  onRowsPerPageChange: jest.fn(),
  periodId: "2026-07" as string | null,
  onClearPeriod: jest.fn(),
  isLoading: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUsageLedger.mockReturnValue({
    data: { entries: [entry()], total: 1 },
    isLoading: false,
    isError: false,
    error: null,
  });
});

// ── UI tests (case 19) ───────────────────────────────────────────────

describe("UsageLedgerDialogUI (#179 slice 3)", () => {
  it("renders rows with tool, class, units, and who", () => {
    render(
      <UsageLedgerDialogUI
        {...uiProps}
        entries={[
          entry({ toolName: "web_search", units: 2, userId: "user-9" }),
          entry({ toolName: "geocode", costClass: "expensive" }),
        ]}
        total={2}
      />
    );

    expect(screen.getByText("Itemized usage")).toBeInTheDocument();
    expect(screen.getByText("web_search")).toBeInTheDocument();
    expect(screen.getByText("geocode")).toBeInTheDocument();
    expect(screen.getByText("expensive")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("user-9")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<UsageLedgerDialogUI {...uiProps} open={false} />);
    expect(screen.queryByText("Itemized usage")).not.toBeInTheDocument();
  });

  it("shows the empty state when there are no entries", () => {
    render(<UsageLedgerDialogUI {...uiProps} entries={[]} total={0} />);
    expect(
      screen.getByText(/No charged tool calls in this period yet/)
    ).toBeInTheDocument();
  });

  it("pagination reflects total and forwards page changes", async () => {
    const onPageChange = jest.fn();
    render(
      <UsageLedgerDialogUI
        {...uiProps}
        entries={[entry()]}
        total={25}
        onPageChange={onPageChange}
      />
    );

    expect(screen.getByText(/1–10 of 25/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /go to next page/i })
    );
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("shows the period filter chip and forwards its clearing", async () => {
    const onClearPeriod = jest.fn();
    render(
      <UsageLedgerDialogUI
        {...uiProps}
        entries={[entry()]}
        total={1}
        onClearPeriod={onClearPeriod}
      />
    );

    expect(screen.getByText("Period 2026-07")).toBeInTheDocument();
    const chip = screen.getByText("Period 2026-07").closest(".MuiChip-root");
    await userEvent.click(chip!.querySelector(".MuiChip-deleteIcon")!);
    expect(onClearPeriod).toHaveBeenCalled();
  });

  it("calls onClose from the Close action", async () => {
    const onClose = jest.fn();
    render(<UsageLedgerDialogUI {...uiProps} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

// ── Container tests (case 20's dialog half) ──────────────────────────

describe("UsageLedgerDialog container (#179 slice 3)", () => {
  it("queries the sdk with the default period filter and renders the page", () => {
    render(
      <UsageLedgerDialog
        open={true}
        onClose={jest.fn()}
        defaultPeriodId="2026-07"
      />
    );

    expect(mockUsageLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 10,
        offset: 0,
        sortBy: "created",
        sortOrder: "desc",
        periodId: "2026-07",
      }),
      expect.objectContaining({ enabled: true })
    );
    expect(screen.getByText("web_search")).toBeInTheDocument();
  });

  it("disables the query while closed", () => {
    render(<UsageLedgerDialog open={false} onClose={jest.fn()} />);
    expect(mockUsageLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false })
    );
  });
});
