import { jest } from "@jest/globals";
import type { PortalResult } from "@portalai/core/models";

const { render, screen, fireEvent } = await import("./test-utils");
const { PinnedResultCardUI, PinnedResultsListUI } = await import(
  "../components/PinnedResultsList.component"
);

const makePinnedResult = (overrides: Partial<PortalResult> = {}): PortalResult => ({
  id: "result-1",
  organizationId: "org-1",
  stationId: "station-1",
  portalId: "portal-1",
  messageId: null,
  blockIndex: null,
  name: "Revenue Summary",
  type: "text",
  content: { text: "Total revenue: $1.2M" },
  created: Date.now() - 3600000, // 1 hour ago
  createdBy: "user-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  ...overrides,
});

const result1 = makePinnedResult();
const result2 = makePinnedResult({
  id: "result-2",
  name: "Sales Chart",
  type: "vega-lite",
  created: Date.now() - 86400000, // 1 day ago
});

// ── PinnedResultCardUI ──────────────────────────────────────────────

describe("PinnedResultCardUI", () => {
  const defaultCardProps = {
    result: result1,
    onResultClick: jest.fn(),
    onUnpin: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render result name and relative timestamp", () => {
    render(<PinnedResultCardUI {...defaultCardProps} />);
    expect(screen.getByText("Revenue Summary")).toBeInTheDocument();
    expect(screen.getByText("1h ago")).toBeInTheDocument();
  });

  it("should call onResultClick with result id when card is clicked", () => {
    const onResultClick = jest.fn();
    render(<PinnedResultCardUI {...defaultCardProps} onResultClick={onResultClick} />);
    fireEvent.click(screen.getByText("Revenue Summary"));
    expect(onResultClick).toHaveBeenCalledWith("result-1");
  });

  it("should call onUnpin with result id when unpin button is clicked", () => {
    const onUnpin = jest.fn();
    render(<PinnedResultCardUI {...defaultCardProps} onUnpin={onUnpin} />);
    fireEvent.click(screen.getByRole("button", { name: "Unpin" }));
    expect(onUnpin).toHaveBeenCalledWith("result-1");
  });

  it("should not trigger card click when unpin button is clicked", () => {
    const onResultClick = jest.fn();
    const onUnpin = jest.fn();
    render(
      <PinnedResultCardUI
        {...defaultCardProps}
        onResultClick={onResultClick}
        onUnpin={onUnpin}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Unpin" }));
    expect(onUnpin).toHaveBeenCalledWith("result-1");
    expect(onResultClick).not.toHaveBeenCalled();
  });
});

// ── PinnedResultsListUI ─────────────────────────────────────────────

describe("PinnedResultsListUI", () => {
  const defaultListProps = {
    results: [result1, result2],
    onResultClick: jest.fn(),
    onUnpin: jest.fn(),
    onViewAll: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render multiple pinned result cards", () => {
    render(<PinnedResultsListUI {...defaultListProps} />);
    expect(screen.getByText("Revenue Summary")).toBeInTheDocument();
    expect(screen.getByText("Sales Chart")).toBeInTheDocument();
  });

  it("should render empty-state placeholder when results is empty", () => {
    render(<PinnedResultsListUI {...defaultListProps} results={[]} />);
    expect(screen.getByTestId("empty-pinned-results")).toBeInTheDocument();
    expect(
      screen.getByText(/No pinned results yet/)
    ).toBeInTheDocument();
  });

  it("should render View All link", () => {
    render(<PinnedResultsListUI {...defaultListProps} />);
    expect(screen.getByTestId("view-all-pinned-results")).toBeInTheDocument();
    expect(screen.getByText("View All")).toBeInTheDocument();
  });

  it("should call onViewAll when View All is clicked", () => {
    const onViewAll = jest.fn();
    render(<PinnedResultsListUI {...defaultListProps} onViewAll={onViewAll} />);
    fireEvent.click(screen.getByTestId("view-all-pinned-results"));
    expect(onViewAll).toHaveBeenCalled();
  });

  it("should not render View All link in empty state", () => {
    render(<PinnedResultsListUI {...defaultListProps} results={[]} />);
    expect(screen.queryByTestId("view-all-pinned-results")).not.toBeInTheDocument();
  });
});
