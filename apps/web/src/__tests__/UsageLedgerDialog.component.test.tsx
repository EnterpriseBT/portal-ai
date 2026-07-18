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
type ToolbarProps =
  import("../components/PaginationToolbar.component").PaginationToolbarProps;

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

const toolbarProps = (over: Partial<ToolbarProps> = {}): ToolbarProps => ({
  search: "",
  onSearchChange: jest.fn(),
  filterConfigs: [],
  filters: {},
  onFilterValueChange: jest.fn(),
  onFilterChange: jest.fn(),
  activeFilterCount: 0,
  sortFields: [
    { field: "created", label: "When" },
    { field: "units", label: "Units" },
    { field: "toolName", label: "Tool" },
  ],
  sortBy: "created",
  onSortByChange: jest.fn(),
  sortOrder: "desc",
  onSortOrderChange: jest.fn(),
  offset: 0,
  limit: 10,
  limitOptions: [5, 10, 20, 50, 100],
  onLimitChange: jest.fn(),
  total: 1,
  currentPage: 1,
  totalPages: 1,
  onFirst: jest.fn(),
  onPrev: jest.fn(),
  onNext: jest.fn(),
  onLast: jest.fn(),
  ...over,
});

const uiProps = {
  open: true,
  onClose: jest.fn(),
  entries: [] as ReturnType<typeof entry>[],
  toolbarProps: toolbarProps(),
  sortBy: "created",
  sortOrder: "desc" as const,
  onSort: jest.fn(),
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
  it("renders rows in the DataTable with tool, class, units, and who", () => {
    render(
      <UsageLedgerDialogUI
        {...uiProps}
        entries={[
          entry({ toolName: "web_search", units: 2, userId: "user-9" }),
          entry({ toolName: "geocode", costClass: "expensive" }),
        ]}
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

  it("shows the DataTable empty state when there are no entries", () => {
    render(<UsageLedgerDialogUI {...uiProps} entries={[]} />);
    expect(
      screen.getByText("No charged tool calls match the current filters.")
    ).toBeInTheDocument();
  });

  it("renders the pagination toolbar (page controls from props)", () => {
    render(
      <UsageLedgerDialogUI
        {...uiProps}
        entries={[entry()]}
        toolbarProps={toolbarProps({ total: 25, totalPages: 3 })}
      />
    );
    expect(
      screen.getByRole("button", { name: "Next page" })
    ).toBeInTheDocument();
  });

  it("clicking a sortable column header forwards to onSort", async () => {
    const onSort = jest.fn();
    render(
      <UsageLedgerDialogUI {...uiProps} entries={[entry()]} onSort={onSort} />
    );

    await userEvent.click(screen.getByText("Tool"));
    expect(onSort).toHaveBeenCalledWith("toolName");
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
  it("queries the sdk with the default period filter + newest-first sort", () => {
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
