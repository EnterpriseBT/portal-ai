import { jest } from "@jest/globals";
import {
  render,
  screen,
  fireEvent,
  act,
  expectNoAxeViolations,
} from "./test-utils";
import { IconName } from "@portalai/core/ui";
import { SidebarNavItemUI } from "../components/SidebarNavItem.component";

describe("SidebarNavItemUI", () => {
  const defaultProps = {
    icon: IconName.Home,
    label: "Dashboard",
    collapsed: false,
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders icon and label when expanded", () => {
    render(<SidebarNavItemUI {...defaultProps} />);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("renders icon only when collapsed", () => {
    render(<SidebarNavItemUI {...defaultProps} collapsed={true} />);

    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("calls onClick when no children", () => {
    const onClick = jest.fn();
    render(<SidebarNavItemUI {...defaultProps} onClick={onClick} />);

    fireEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("calls onToggle (not onClick) when children exist", () => {
    const onClick = jest.fn();
    const onToggle = jest.fn();
    render(
      <SidebarNavItemUI {...defaultProps} onClick={onClick} onToggle={onToggle}>
        <li>Child</li>
      </SidebarNavItemUI>
    );

    fireEvent.click(screen.getByRole("button", { name: /Dashboard/i }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows children when open is true", () => {
    render(
      <SidebarNavItemUI {...defaultProps} open={true}>
        <li>Child Item</li>
      </SidebarNavItemUI>
    );

    expect(screen.getByText("Child Item")).toBeVisible();
  });

  it("hides children when open is false", () => {
    render(
      <SidebarNavItemUI {...defaultProps} open={false}>
        <li>Child Item</li>
      </SidebarNavItemUI>
    );

    expect(screen.getByText("Child Item")).not.toBeVisible();
  });

  it("hides children when collapsed even if open", () => {
    render(
      <SidebarNavItemUI {...defaultProps} collapsed={true} open={true}>
        <li>Child Item</li>
      </SidebarNavItemUI>
    );

    expect(screen.getByText("Child Item")).not.toBeVisible();
  });

  it("shows expand indicator when children exist and closed", () => {
    render(
      <SidebarNavItemUI {...defaultProps} open={false}>
        <li>Child</li>
      </SidebarNavItemUI>
    );

    expect(screen.getByTestId("ExpandMoreIcon")).toBeInTheDocument();
  });

  it("shows collapse indicator when children exist and open", () => {
    render(
      <SidebarNavItemUI {...defaultProps} open={true}>
        <li>Child</li>
      </SidebarNavItemUI>
    );

    expect(screen.getByTestId("ExpandLessIcon")).toBeInTheDocument();
  });

  it("calls onClose on outside click", () => {
    const onClose = jest.fn();
    render(
      <div>
        <SidebarNavItemUI {...defaultProps} onClose={onClose} open={true}>
          <li>Child</li>
        </SidebarNavItemUI>
        <button data-testid="outside">Outside</button>
      </div>
    );

    // ClickAwayListener activates after a setTimeout(0)
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByTestId("outside"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose on inside click", () => {
    const onClose = jest.fn();
    render(
      <div>
        <SidebarNavItemUI {...defaultProps} onClose={onClose} open={true}>
          <li>Child</li>
        </SidebarNavItemUI>
        <button data-testid="outside">Outside</button>
      </div>
    );

    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByRole("button", { name: /Dashboard/i }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("renders selected state", () => {
    render(<SidebarNavItemUI {...defaultProps} selected={true} />);

    expect(screen.getByRole("button")).toHaveClass("Mui-selected");
  });

  it("renders child items from items prop", () => {
    const items = [
      { label: "Child A", onClick: jest.fn() },
      { label: "Child B", onClick: jest.fn() },
    ];
    render(<SidebarNavItemUI {...defaultProps} items={items} open={true} />);

    expect(screen.getByText("Child A")).toBeVisible();
    expect(screen.getByText("Child B")).toBeVisible();
  });

  it("renders selected state on child item", () => {
    const items = [{ label: "Child A", selected: true }, { label: "Child B" }];
    render(<SidebarNavItemUI {...defaultProps} items={items} open={true} />);

    const buttons = screen.getAllByRole("button");
    // buttons[0] = parent, buttons[1] = Child A, buttons[2] = Child B
    expect(buttons[1]).toHaveClass("Mui-selected");
    expect(buttons[2]).not.toHaveClass("Mui-selected");
  });

  it("calls child item onClick when clicked", () => {
    const onChildClick = jest.fn();
    const items = [{ label: "Child A", onClick: onChildClick }];
    render(<SidebarNavItemUI {...defaultProps} items={items} open={true} />);

    fireEvent.click(screen.getByText("Child A"));

    expect(onChildClick).toHaveBeenCalledTimes(1);
  });

  it("treats items prop as having children for toggle behavior", () => {
    const onToggle = jest.fn();
    const items = [{ label: "Child A" }];
    render(
      <SidebarNavItemUI {...defaultProps} items={items} onToggle={onToggle} />
    );

    fireEvent.click(screen.getByRole("button", { name: /Dashboard/i }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  describe("navigation semantics (#797)", () => {
    beforeEach(() => {
      jest.useRealTimers();
    });

    it("renders a destination as a link to its route", () => {
      render(<SidebarNavItemUI {...defaultProps} href="/connectors" />);
      expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
        "href",
        "/connectors"
      );
    });

    it("marks the current page", () => {
      render(<SidebarNavItemUI {...defaultProps} href="/" selected />);
      expect(screen.getByRole("link")).toHaveAttribute("aria-current", "page");
    });

    it("leaves other pages unmarked", () => {
      // The test router sits at "/", so another route isn't current.
      render(<SidebarNavItemUI {...defaultProps} href="/connectors" />);
      expect(screen.getByRole("link")).not.toHaveAttribute("aria-current");
    });

    it("names a collapsed item by its label and shows it as a tooltip on focus", async () => {
      render(<SidebarNavItemUI {...defaultProps} collapsed href="/" />);
      const link = screen.getByRole("link", { name: "Dashboard" });
      act(() => link.focus());
      expect(await screen.findByRole("tooltip")).toHaveTextContent("Dashboard");
    });

    it("still runs onClick alongside the link (the mobile drawer closes)", () => {
      const onClick = jest.fn();
      render(<SidebarNavItemUI {...defaultProps} href="/" onClick={onClick} />);
      fireEvent.click(screen.getByRole("link"));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("keeps an action with no route (Logout) a button", () => {
      render(<SidebarNavItemUI {...defaultProps} label="Logout" />);
      expect(
        screen.getByRole("button", { name: "Logout" })
      ).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("tells whether a parent is expanded", () => {
      render(
        <SidebarNavItemUI {...defaultProps} items={[{ label: "Child" }]} open />
      );
      expect(screen.getByRole("button", { name: "Dashboard" })).toHaveAttribute(
        "aria-expanded",
        "true"
      );
    });

    it.each([false, true])(
      "has no axe violations (collapsed: %s)",
      async (collapsed) => {
        const { container } = render(
          <nav aria-label="Primary">
            <SidebarNavItemUI
              {...defaultProps}
              collapsed={collapsed}
              href="/"
            />
          </nav>
        );
        await expectNoAxeViolations(container);
      }
    );
  });

  it("has no axe violations with its children open (#797)", async () => {
    jest.useRealTimers();
    const { container } = render(
      <nav aria-label="Primary">
        <SidebarNavItemUI {...defaultProps} items={[{ label: "Child" }]} open />
      </nav>
    );
    await expectNoAxeViolations(container);
  });
});
