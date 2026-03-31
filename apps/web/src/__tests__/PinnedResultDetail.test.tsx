import { jest } from "@jest/globals";
import type { PortalResult } from "@portalai/core/models";

const { render, screen, fireEvent } = await import("./test-utils");
const { PinnedResultDetailUI } = await import(
  "../views/PinnedResultDetail.view"
);

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
    expect(screen.getByRole("heading", { name: "Revenue Summary" })).toBeInTheDocument();
    expect(screen.getByText("Text")).toBeInTheDocument();
  });

  it("should render Chart chip for vega-lite type", () => {
    render(
      <PinnedResultDetailUI
        {...defaultProps}
        result={makePinnedResult({ type: "vega-lite", content: { $schema: "https://vega.github.io/schema/vega-lite/v5.json" } })}
      />
    );
    expect(screen.getByText("Chart")).toBeInTheDocument();
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
    expect(screen.getAllByText("Revenue Summary").length).toBeGreaterThanOrEqual(2);
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
    expect(screen.getByRole("menuitem", { name: /Open Source Portal/i })).toBeInTheDocument();
  });

  it("should call onOpenPortal when Open Source Portal is clicked", () => {
    const onOpenPortal = jest.fn();
    render(
      <PinnedResultDetailUI {...defaultProps} onOpenPortal={onOpenPortal} />
    );
    fireEvent.click(screen.getByRole("button", { name: /More actions/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Open Source Portal/i }));
    expect(onOpenPortal).toHaveBeenCalledWith("portal-1");
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
