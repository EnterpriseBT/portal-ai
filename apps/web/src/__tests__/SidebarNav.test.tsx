import { render, screen } from "./test-utils";
import { SidebarNavUI } from "../components/SidebarNav.component";

describe("SidebarNavUI", () => {
  const defaultProps = {
    collapsed: false,
    hidden: false,
  };

  it("renders children", () => {
    render(
      <SidebarNavUI {...defaultProps}>
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    expect(screen.getByText("Nav Content")).toBeInTheDocument();
  });

  it("renders footer as ReactNode", () => {
    render(
      <SidebarNavUI {...defaultProps} footer={<div>Footer Content</div>}>
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    expect(screen.getByText("Footer Content")).toBeInTheDocument();
  });

  it("renders footer from render prop function", () => {
    render(
      <SidebarNavUI
        {...defaultProps}
        footer={() => <div>Render Prop Footer</div>}
      >
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    expect(screen.getByText("Render Prop Footer")).toBeInTheDocument();
  });

  it("does not render footer divider when no footer", () => {
    const { container } = render(
      <SidebarNavUI {...defaultProps}>
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    expect(container.querySelector("hr")).not.toBeInTheDocument();
  });

  it("renders footer divider when footer is present", () => {
    const { container } = render(
      <SidebarNavUI {...defaultProps} footer={<div>Footer</div>}>
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    expect(container.querySelector("hr")).toBeInTheDocument();
  });

  it("hides drawer when hidden is true", () => {
    render(
      <SidebarNavUI {...defaultProps} hidden={true}>
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    const wrapper = screen.getByText("Nav Content").closest(".MuiDrawer-root")
      ?.parentElement;
    expect(wrapper).toHaveStyle({ display: "none" });
  });

  it("shows drawer when hidden is false", () => {
    render(
      <SidebarNavUI {...defaultProps} hidden={false}>
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    const wrapper = screen.getByText("Nav Content").closest(".MuiDrawer-root")
      ?.parentElement;
    expect(wrapper).not.toHaveStyle({ display: "none" });
  });

});
