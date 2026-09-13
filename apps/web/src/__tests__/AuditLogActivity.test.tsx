import { jest } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockAuditLogList = jest.fn();

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    auditLog: {
      list: mockAuditLogList,
    },
  },
}));

const { render, screen } = await import("./test-utils");
const userEvent = (await import("@testing-library/user-event")).default;
const { AuditLogActivity, AuditLogActivityUI } =
  await import("../components/AuditLogActivity.component");
type ToolbarProps =
  import("../components/PaginationToolbar.component").PaginationToolbarProps;
type Entry = import("@portalai/core/models").AuditLogEntry;

// ── Fixtures ─────────────────────────────────────────────────────────

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: `entry-${Math.random().toString(36).slice(2)}`,
  created: 1_784_000_000_000,
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  organizationId: "org-1",
  userId: "user-1",
  action: "auth.login",
  targetType: null,
  targetId: null,
  outcome: "success",
  sourceIp: "203.0.113.7",
  userAgent: "Mozilla/5.0",
  metadata: null,
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
  sortFields: [{ field: "created", label: "When" }],
  sortBy: "created",
  onSortByChange: jest.fn(),
  sortOrder: "desc",
  onSortOrderChange: jest.fn(),
  offset: 0,
  limit: 20,
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

const uiProps: import("../components/AuditLogActivity.component").AuditLogActivityUIProps =
  {
    entries: [],
    toolbarProps: toolbarProps(),
    sortBy: "created",
    sortOrder: "desc",
    onSort: jest.fn(),
    isLoading: false,
    error: null,
  };

beforeEach(() => {
  jest.clearAllMocks();
  mockAuditLogList.mockReturnValue({
    data: { entries: [entry()], total: 1 },
    isLoading: false,
    isError: false,
    error: null,
  });
});

// ── UI tests ─────────────────────────────────────────────────────────

describe("AuditLogActivityUI (#596)", () => {
  it("renders an entry's when / actor / action / target / outcome / IP / UA", () => {
    render(
      <AuditLogActivityUI
        {...uiProps}
        entries={[
          entry({
            userId: "user-9",
            action: "connector.credential.access",
            targetType: "connector_instance",
            targetId: "ci-42",
            outcome: "failure",
            sourceIp: "198.51.100.4",
            userAgent: "curl/8.0",
          }),
        ]}
      />
    );

    expect(screen.getByText("user-9")).toBeInTheDocument();
    expect(screen.getByText("connector.credential.access")).toBeInTheDocument();
    expect(screen.getByText("connector_instance · ci-42")).toBeInTheDocument();
    expect(screen.getByText("failure")).toBeInTheDocument();
    expect(screen.getByText("198.51.100.4")).toBeInTheDocument();
    expect(screen.getByText("curl/8.0")).toBeInTheDocument();
  });

  it("shows the empty state when there are no entries", () => {
    render(<AuditLogActivityUI {...uiProps} entries={[]} />);
    expect(
      screen.getByText("No audit-log entries match the current filters.")
    ).toBeInTheDocument();
  });

  it("shows a spinner while loading and no table", () => {
    render(<AuditLogActivityUI {...uiProps} isLoading entries={[]} />);
    expect(screen.getByLabelText("Loading audit log")).toBeInTheDocument();
    expect(
      screen.queryByText("No audit-log entries match the current filters.")
    ).not.toBeInTheDocument();
  });

  it("renders a fetch error inline instead of a blank panel", () => {
    render(
      <AuditLogActivityUI
        {...uiProps}
        entries={[]}
        error={new Error("Audit log unavailable")}
      />
    );
    expect(screen.getByText("Audit log unavailable")).toBeInTheDocument();
  });

  it("renders the pagination toolbar (page controls from props)", () => {
    render(
      <AuditLogActivityUI
        {...uiProps}
        entries={[entry()]}
        toolbarProps={toolbarProps({ total: 45, totalPages: 3 })}
      />
    );
    expect(
      screen.getByRole("button", { name: "Next page" })
    ).toBeInTheDocument();
  });

  it("forwards a sortable column-header click to onSort", async () => {
    const onSort = jest.fn();
    render(
      <AuditLogActivityUI {...uiProps} entries={[entry()]} onSort={onSort} />
    );
    await userEvent.click(screen.getByText("When"));
    expect(onSort).toHaveBeenCalledWith("created");
  });
});

// ── Container tests ──────────────────────────────────────────────────

describe("AuditLogActivity container (#596)", () => {
  it("queries the audit-log read API newest-first with a 20-row page", () => {
    render(<AuditLogActivity />);

    expect(mockAuditLogList).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: 20,
        offset: 0,
        sortBy: "created",
        sortOrder: "desc",
      })
    );
    expect(screen.getByText("user-1")).toBeInTheDocument();
  });
});
