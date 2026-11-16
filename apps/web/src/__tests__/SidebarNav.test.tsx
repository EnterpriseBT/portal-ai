import { jest } from "@jest/globals";
import {
  render,
  screen,
  waitFor,
  within,
  expectNoAxeViolations,
} from "./test-utils";
import userEvent from "@testing-library/user-event";
import { SidebarNav, SidebarNavUI } from "../components/SidebarNav.component";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";

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

    const wrapper = screen
      .getByText("Nav Content")
      .closest(".MuiDrawer-root")?.parentElement;
    expect(wrapper).toHaveStyle({ display: "none" });
  });

  it("shows drawer when hidden is false", () => {
    render(
      <SidebarNavUI {...defaultProps} hidden={false}>
        <div>Nav Content</div>
      </SidebarNavUI>
    );

    const wrapper = screen
      .getByText("Nav Content")
      .closest(".MuiDrawer-root")?.parentElement;
    expect(wrapper).not.toHaveStyle({ display: "none" });
  });

  // Adversarial walk F2: the open mobile drawer ignored Escape.
  describe("Escape (#797)", () => {
    it("calls onEscape for an Escape pressed inside the drawer", async () => {
      const onEscape = jest.fn();
      render(
        <SidebarNavUI {...defaultProps} onEscape={onEscape}>
          <a href="/help">Help</a>
        </SidebarNavUI>
      );
      screen.getByRole("link", { name: "Help" }).focus();
      await userEvent.keyboard("{Escape}");
      expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it("ignores other keys, and Escape without an onEscape", async () => {
      const onEscape = jest.fn();
      const { rerender } = render(
        <SidebarNavUI {...defaultProps} onEscape={onEscape}>
          <a href="/help">Help</a>
        </SidebarNavUI>
      );
      screen.getByRole("link", { name: "Help" }).focus();
      await userEvent.keyboard("{Enter}");
      expect(onEscape).not.toHaveBeenCalled();
      rerender(
        <SidebarNavUI {...defaultProps}>
          <a href="/help">Help</a>
        </SidebarNavUI>
      );
      screen.getByRole("link", { name: "Help" }).focus();
      await userEvent.keyboard("{Escape}");
      expect(onEscape).not.toHaveBeenCalled();
    });

    it("leaves an Escape inside a dialog the drawer opened to that dialog", async () => {
      const onEscape = jest.fn();
      render(
        <SidebarNavUI {...defaultProps} onEscape={onEscape}>
          <Dialog open>
            <DialogContent>
              <button type="button">Inside</button>
            </DialogContent>
          </Dialog>
        </SidebarNavUI>
      );
      screen.getByRole("button", { name: "Inside" }).focus();
      await userEvent.keyboard("{Escape}");
      expect(onEscape).not.toHaveBeenCalled();
    });
  });
});

// The shipped dialog, opened from the real caption (#983). These replace
// tests of a hand-built copy that rendered MUI's raw Dialog.
describe("Version dialog", () => {
  const openVersionDialog = async () => {
    const user = userEvent.setup();
    render(<SidebarNav />);
    await user.click(screen.getByRole("button", { name: /app version/ }));
    return {
      user,
      dialog: await screen.findByRole("dialog", { name: "App version" }),
    };
  };

  it("is closed until the caption is pressed", () => {
    render(<SidebarNav />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a visible title and the build's version and SHA", async () => {
    const { dialog } = await openVersionDialog();
    expect(
      within(dialog).getByRole("heading", { name: "App version" })
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText("App version")).toHaveLength(1);
    // Jest has no Vite env, so the build's version and SHA fall back.
    expect(dialog.querySelector("code")).toHaveTextContent(/^dev \(local\)$/);
  });

  it("holds a focusable close button that Tab reaches", async () => {
    const { user, dialog } = await openVersionDialog();
    const close = within(dialog).getByRole("button", { name: "close" });
    // Focus opens on the dialog itself, not already on Close.
    const root = dialog.closest(".MuiDialog-root");
    expect(root).toContainElement(document.activeElement as HTMLElement);
    expect(close).not.toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it("closes from the close button", async () => {
    const { user, dialog } = await openVersionDialog();
    await user.click(within(dialog).getByRole("button", { name: "close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });

  it("has no axe violations when open (#793)", async () => {
    const { dialog } = await openVersionDialog();
    await expectNoAxeViolations(dialog);
  });

  it("still closes on Escape", async () => {
    const { user } = await openVersionDialog();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
  });
});
