import { jest } from "@jest/globals";
import type { PortalResultListResponsePayload } from "@portalai/core/contracts";

type PortalResultWithIncludes =
  PortalResultListResponsePayload["portalResults"][number];

const { render, screen, fireEvent, expectNoAxeViolations } =
  await import("./test-utils");
const { PinnedResultCardUI, PinnedResultsListUI } =
  await import("../components/PinnedResultsList.component");

const makePinnedResult = (
  overrides: Partial<PortalResultWithIncludes> = {}
): PortalResultWithIncludes => ({
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
  definerPrincipalType: "user",
  definerPrincipalId: "user-1",
  definer: { id: "user-1", displayName: "Test User" },
  viewerIsDefiner: true,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
  capabilities: { read: true, write: true, delete: true, share: true },
  ...overrides,
});

// #312: durable viz kinds get their own type icons.
const d3Result = makePinnedResult({
  id: "result-d3",
  name: "Revenue Chart",
  type: "d3",
  content: { program: "api.svg;", rows: [] },
});
const geoResult = makePinnedResult({
  id: "result-geo",
  name: "Parcel Map",
  type: "geo",
  content: { layers: [] },
});

const result1 = makePinnedResult();
const result2 = makePinnedResult({
  id: "result-2",
  name: "Sales Table",
  type: "data-table",
  created: Date.now() - 86400000, // 1 day ago
});

// ── PinnedResultCardUI ──────────────────────────────────────────────

describe("PinnedResultCardUI", () => {
  const defaultCardProps = {
    result: result1,
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

  // #794: the card opens its result through its title's link.
  it("links its title to the result", () => {
    render(<PinnedResultCardUI {...defaultCardProps} />);
    expect(
      screen.getByRole("link", { name: "Revenue Summary" })
    ).toHaveAttribute("href", "/portal-results/result-1");
  });

  it("should call onUnpin with result id when unpin button is clicked", () => {
    const onUnpin = jest.fn();
    render(<PinnedResultCardUI {...defaultCardProps} onUnpin={onUnpin} />);
    fireEvent.click(screen.getByRole("button", { name: "Unpin" }));
    expect(onUnpin).toHaveBeenCalledWith("result-1");
  });

  it("describes Unpin by the card's title", () => {
    render(<PinnedResultCardUI {...defaultCardProps} />);
    expect(
      screen.getByRole("button", { name: "Unpin" })
    ).toHaveAccessibleDescription("Revenue Summary");
  });

  // #640: a shared pin shows its definer's data.
  it("names the definer on a data pin the viewer didn't define", () => {
    render(
      <PinnedResultCardUI
        result={makePinnedResult({
          type: "data-table",
          viewerIsDefiner: false,
          definer: { id: "u-9", displayName: "Ada Lovelace" },
        })}
        onUnpin={jest.fn()}
      />
    );
    expect(screen.getByTestId("pinned-result-definer")).toHaveTextContent(
      "Data as Ada Lovelace sees it"
    );
  });

  it("names no definer on the viewer's own pin, or on a text pin", () => {
    const { rerender } = render(
      <PinnedResultCardUI
        result={makePinnedResult({ type: "data-table", viewerIsDefiner: true })}
        onUnpin={jest.fn()}
      />
    );
    expect(screen.queryByTestId("pinned-result-definer")).toBeNull();
    rerender(
      <PinnedResultCardUI
        result={makePinnedResult({ type: "text", viewerIsDefiner: false })}
        onUnpin={jest.fn()}
      />
    );
    expect(screen.queryByTestId("pinned-result-definer")).toBeNull();
  });

  it("should render portal name when portalName is provided", () => {
    const result = makePinnedResult({ portalName: "Research Portal" });
    render(<PinnedResultCardUI result={result} onUnpin={jest.fn()} />);
    expect(screen.getByText("from Research Portal")).toBeInTheDocument();
  });

  it("should not render portal name when portalName is null", () => {
    const result = makePinnedResult({ portalName: null });
    render(<PinnedResultCardUI result={result} onUnpin={jest.fn()} />);
    expect(screen.queryByText(/from/)).not.toBeInTheDocument();
  });

  it("should not render portal name when portalName is absent", () => {
    const result = makePinnedResult();
    render(<PinnedResultCardUI result={result} onUnpin={jest.fn()} />);
    expect(screen.queryByText(/from/)).not.toBeInTheDocument();
  });

  // #312: durable viz kinds get their own type icons.
  it("should render a chart icon for d3 results", () => {
    render(<PinnedResultCardUI {...defaultCardProps} result={d3Result} />);
    expect(screen.getByTestId("InsertChartOutlinedIcon")).toBeInTheDocument();
  });

  it("should render a map icon for geo results", () => {
    render(<PinnedResultCardUI {...defaultCardProps} result={geoResult} />);
    expect(screen.getByTestId("MapOutlinedIcon")).toBeInTheDocument();
  });
});

// ── PinnedResultsListUI ─────────────────────────────────────────────

describe("PinnedResultsListUI", () => {
  const defaultListProps = {
    results: [result1, result2],
    onUnpin: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render multiple pinned result cards", () => {
    render(<PinnedResultsListUI {...defaultListProps} />);
    expect(screen.getByText("Revenue Summary")).toBeInTheDocument();
    expect(screen.getByText("Sales Table")).toBeInTheDocument();
  });

  it("should render empty-state placeholder when results is empty", () => {
    render(<PinnedResultsListUI {...defaultListProps} results={[]} />);
    expect(screen.getByTestId("empty-pinned-results")).toBeInTheDocument();
    expect(screen.getByText(/No pinned results yet/)).toBeInTheDocument();
  });

  it("should render View All link", () => {
    render(<PinnedResultsListUI {...defaultListProps} />);
    expect(screen.getByTestId("view-all-pinned-results")).toBeInTheDocument();
    expect(screen.getByText("View All")).toBeInTheDocument();
  });

  // #794: View All navigates, so it's a link, in a named list's footer.
  it("links View All to the pinned results page, after a named list", () => {
    render(<PinnedResultsListUI {...defaultListProps} />);
    expect(screen.getByRole("link", { name: "View All" })).toHaveAttribute(
      "href",
      "/portal-results"
    );
    expect(
      screen.getByRole("list", { name: "Pinned results" })
    ).toBeInTheDocument();
  });

  it("should not render View All link in empty state", () => {
    render(<PinnedResultsListUI {...defaultListProps} results={[]} />);
    expect(
      screen.queryByTestId("view-all-pinned-results")
    ).not.toBeInTheDocument();
  });
});

describe("PinnedResultCardUI gates (#690)", () => {
  it("shows Unpin on a pin the caller may delete", () => {
    render(
      <PinnedResultCardUI result={makePinnedResult()} onUnpin={jest.fn()} />
    );
    expect(screen.getByRole("button", { name: "Unpin" })).toBeInTheDocument();
  });

  it("hides Unpin on a pin shared with the caller read-only", () => {
    render(
      <PinnedResultCardUI
        result={makePinnedResult({
          capabilities: {
            read: true,
            write: false,
            delete: false,
            share: false,
          },
        })}
        onUnpin={jest.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "Unpin" })).toBeNull();
  });
});

describe("PinnedResultsListUI accessibility", () => {
  it("has no axe violations with mixed pins", async () => {
    const { container } = render(
      <PinnedResultsListUI
        results={[
          result1,
          result2,
          d3Result,
          makePinnedResult({
            id: "result-geo-shared",
            name: "Parcel Map",
            type: "geo",
            content: { layers: [] },
            viewerIsDefiner: false,
            definer: { id: "user-2", displayName: "Other User" },
            capabilities: {
              read: true,
              write: false,
              delete: false,
              share: false,
            },
          }),
        ]}
        onUnpin={jest.fn()}
      />
    );
    await expectNoAxeViolations(container);
  });

  it("has no axe violations when empty", async () => {
    const { container } = render(
      <PinnedResultsListUI results={[]} onUnpin={jest.fn()} />
    );
    await expectNoAxeViolations(container);
  });
});
