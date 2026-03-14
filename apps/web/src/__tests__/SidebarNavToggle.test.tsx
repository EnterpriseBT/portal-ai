import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "./test-utils";
import { IconName } from "@portalai/core/ui";
import { SidebarNavToggleUI } from "../components/SidebarNavToggle.component";

describe("SidebarNavToggleUI", () => {
  it("renders the collapsed icon when collapsed", () => {
    const { container } = render(
      <SidebarNavToggleUI collapsed={true} onClick={jest.fn()} />
    );

    expect(
      container.querySelector("[data-testid='KeyboardDoubleArrowRightIcon']")
    ).toBeInTheDocument();
  });

  it("renders the expanded icon when not collapsed", () => {
    const { container } = render(
      <SidebarNavToggleUI collapsed={false} onClick={jest.fn()} />
    );

    expect(
      container.querySelector("[data-testid='KeyboardDoubleArrowLeftIcon']")
    ).toBeInTheDocument();
  });

  it("renders custom collapsed icon", () => {
    const { container } = render(
      <SidebarNavToggleUI
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
    render(<SidebarNavToggleUI collapsed={false} onClick={onClick} />);

    fireEvent.click(screen.getByRole("button", { name: /toggle sidebar/i }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
