import { jest } from "@jest/globals";

const { render, screen, fireEvent } = await import("./test-utils");
const { DashboardViewUI } = await import("../views/Dashboard.view");

const defaultUIProps = {
  onNewPortal: jest.fn(),
  onPortalClick: jest.fn(),
  onDeletePortal: jest.fn(),
  onResultClick: jest.fn(),
  onUnpin: jest.fn(),
  onViewAllResults: jest.fn(),
};

describe("DashboardViewUI", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders Recent Portals section", () => {
    render(<DashboardViewUI {...defaultUIProps} />);
    expect(screen.getByText("Recent Portals")).toBeInTheDocument();
  });

  it("renders Pinned Results section", () => {
    render(<DashboardViewUI {...defaultUIProps} />);
    expect(screen.getByText("Pinned Results")).toBeInTheDocument();
  });

  it("does not render Default Station section", () => {
    render(<DashboardViewUI {...defaultUIProps} />);
    expect(screen.queryByText("Default Station")).not.toBeInTheDocument();
  });

  it("renders Launch New Portal button", () => {
    render(<DashboardViewUI {...defaultUIProps} />);
    expect(
      screen.getByRole("button", { name: /Launch New Portal/i })
    ).toBeInTheDocument();
  });

  it("calls onNewPortal when Launch New Portal is clicked", () => {
    const onNewPortal = jest.fn();
    render(<DashboardViewUI {...defaultUIProps} onNewPortal={onNewPortal} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Launch New Portal/i })
    );
    expect(onNewPortal).toHaveBeenCalled();
  });
});
