import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "./test-utils";
import { IconName } from "@portalai/core/ui";
import {
  SidebarNavToggleUI,
  toggleTargetWidth,
} from "../components/SidebarNavToggle.component";

describe("SidebarNavToggleUI", () => {
  it("renders the collapsed icon when collapsed", () => {
    const { container } = render(
      <SidebarNavToggleUI
        variant="compact"
        collapsed={true}
        onClick={jest.fn()}
      />
    );

    expect(
      container.querySelector("[data-testid='KeyboardArrowRightIcon']")
    ).toBeInTheDocument();
  });

  it("renders the expanded icon when not collapsed", () => {
    const { container } = render(
      <SidebarNavToggleUI
        variant="compact"
        collapsed={false}
        onClick={jest.fn()}
      />
    );

    expect(
      container.querySelector("[data-testid='KeyboardArrowLeftIcon']")
    ).toBeInTheDocument();
  });

  it("renders custom collapsed icon", () => {
    const { container } = render(
      <SidebarNavToggleUI
        variant="compact"
        collapsed={true}
        collapsedIcon={IconName.Menu}
        onClick={jest.fn()}
      />
    );

    expect(
      container.querySelector("[data-testid='MenuIcon']")
    ).toBeInTheDocument();
  });

  it("renders custom expanded icon", () => {
    const { container } = render(
      <SidebarNavToggleUI
        variant="compact"
        collapsed={false}
        expandedIcon={IconName.Close}
        onClick={jest.fn()}
      />
    );

    expect(
      container.querySelector("[data-testid='CloseIcon']")
    ).toBeInTheDocument();
  });

  it("calls onClick when clicked", () => {
    const onClick = jest.fn();
    render(
      <SidebarNavToggleUI
        variant="compact"
        collapsed={false}
        onClick={onClick}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /toggle sidebar/i }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  describe("accessibility (#797)", () => {
    it.each([
      [true, "false"],
      [false, "true"],
    ])(
      "collapsed=%s reports aria-expanded=%s and controls the nav",
      (collapsed, expanded) => {
        render(
          <SidebarNavToggleUI
            variant="compact"
            collapsed={collapsed}
            onClick={jest.fn()}
            controlsId="primary-nav"
          />
        );
        const button = screen.getByRole("button", { name: "toggle sidebar" });
        expect(button).toHaveAttribute("aria-expanded", expanded);
        expect(button).toHaveAttribute("aria-controls", "primary-nav");
      }
    );

    it("gives the 16px compact toggle a target of at least 24px", () => {
      const width = (variant: "compact" | "full") =>
        toggleTargetWidth(variant, (n: number) => `${n * 8}px`);
      expect(width("compact")).toBeGreaterThanOrEqual(24);
      expect(width("full")).toBeGreaterThanOrEqual(24);
    });
  });

  it("names no controlled element when it isn't told one (no dangling aria-controls)", () => {
    render(
      <SidebarNavToggleUI variant="compact" collapsed onClick={jest.fn()} />
    );
    expect(
      screen.getByRole("button", { name: "toggle sidebar" })
    ).not.toHaveAttribute("aria-controls");
  });
});
