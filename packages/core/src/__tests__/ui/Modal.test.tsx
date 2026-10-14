import React from "react";
import { render, screen } from "@testing-library/react";
import ReactDOM from "react-dom";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { Modal } from "../../ui/Modal";

describe("Modal Component", () => {
  const defaultProps = {
    open: true,
    onClose: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Rendering", () => {
    it("should render children when open", () => {
      render(
        <Modal {...defaultProps}>
          <p>Modal content</p>
        </Modal>
      );
      expect(screen.getByText("Modal content")).toBeInTheDocument();
    });

    it("should not render content when closed", () => {
      render(
        <Modal {...defaultProps} open={false}>
          <p>Modal content</p>
        </Modal>
      );
      expect(screen.queryByText("Modal content")).not.toBeInTheDocument();
    });

    it("should render title when provided", () => {
      render(
        <Modal {...defaultProps} title="Test Title">
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByText("Test Title")).toBeInTheDocument();
    });

    it("should render actions when provided", () => {
      render(
        <Modal {...defaultProps} actions={<button>Save</button>}>
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByText("Save")).toBeInTheDocument();
    });

    it("should not render actions section when no actions provided", () => {
      const { container } = render(
        <Modal {...defaultProps}>
          <p>Content</p>
        </Modal>
      );
      expect(
        container.querySelector(".MuiDialogActions-root")
      ).not.toBeInTheDocument();
    });
  });

  describe("Close Button", () => {
    it("should render close button by default", () => {
      render(
        <Modal {...defaultProps} title="Title">
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByLabelText("close")).toBeInTheDocument();
    });

    it("should call onClose when close button is clicked", async () => {
      render(
        <Modal {...defaultProps} title="Title">
          <p>Content</p>
        </Modal>
      );
      await userEvent.click(screen.getByLabelText("close"));
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it("should not render close button when showCloseButton is false", () => {
      render(
        <Modal {...defaultProps} title="Title" showCloseButton={false}>
          <p>Content</p>
        </Modal>
      );
      expect(screen.queryByLabelText("close")).not.toBeInTheDocument();
    });
  });

  describe("Backdrop", () => {
    it("should call onClose when backdrop is clicked", async () => {
      render(
        <Modal {...defaultProps} title="Title">
          <p>Content</p>
        </Modal>
      );
      const backdrop = document.querySelector(".MuiBackdrop-root");
      if (backdrop) {
        await userEvent.click(backdrop as Element);
        expect(defaultProps.onClose).toHaveBeenCalled();
      }
    });
  });

  describe("Maximize toggle", () => {
    it("does not render the maximize button by default", () => {
      render(
        <Modal {...defaultProps} title="Title">
          <p>Content</p>
        </Modal>
      );
      expect(screen.queryByLabelText("maximize")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("restore")).not.toBeInTheDocument();
    });

    it("renders the maximize button when maximizable={true}", () => {
      render(
        <Modal {...defaultProps} title="Title" maximizable>
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByLabelText("maximize")).toBeInTheDocument();
    });

    it("renders the maximize button when only a title is set (no close button)", () => {
      render(
        <Modal
          {...defaultProps}
          title="Title"
          maximizable
          showCloseButton={false}
        >
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByLabelText("maximize")).toBeInTheDocument();
      expect(screen.queryByLabelText("close")).not.toBeInTheDocument();
    });

    it("toggles to fullScreen on maximize click and back on restore click", async () => {
      render(
        <Modal {...defaultProps} title="Title" maximizable>
          <p>Content</p>
        </Modal>
      );
      // Default is not full-screen — MUI Dialog applies the
      // `MuiDialog-paperFullScreen` class only when fullScreen={true}.
      expect(
        document.querySelector(".MuiDialog-paperFullScreen")
      ).not.toBeInTheDocument();

      await userEvent.click(screen.getByLabelText("maximize"));
      expect(
        document.querySelector(".MuiDialog-paperFullScreen")
      ).toBeInTheDocument();

      // The button now offers the inverse action.
      await userEvent.click(screen.getByLabelText("restore"));
      expect(
        document.querySelector(".MuiDialog-paperFullScreen")
      ).not.toBeInTheDocument();
    });

    it("swaps the icon between OpenInFull and CloseFullscreen on toggle", async () => {
      render(
        <Modal {...defaultProps} title="Title" maximizable>
          <p>Content</p>
        </Modal>
      );
      // Material Icons render an inline SVG with a `data-testid` like
      // `OpenInFullIcon` / `CloseFullscreenIcon`.
      expect(screen.getByTestId("OpenInFullIcon")).toBeInTheDocument();
      expect(
        screen.queryByTestId("CloseFullscreenIcon")
      ).not.toBeInTheDocument();

      await userEvent.click(screen.getByLabelText("maximize"));
      expect(screen.getByTestId("CloseFullscreenIcon")).toBeInTheDocument();
      expect(screen.queryByTestId("OpenInFullIcon")).not.toBeInTheDocument();
    });

    it("renders the maximize button to the left of the close button in DOM order", () => {
      render(
        <Modal {...defaultProps} title="Title" maximizable>
          <p>Content</p>
        </Modal>
      );
      const maximize = screen.getByLabelText("maximize");
      const close = screen.getByLabelText("close");
      // Both icons live inside the same header row; document position
      // FOLLOWING means `close` comes after `maximize`.
      expect(
        maximize.compareDocumentPosition(close) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it("uses the defaultMaximized initial state when provided", () => {
      render(
        <Modal {...defaultProps} title="Title" maximizable defaultMaximized>
          <p>Content</p>
        </Modal>
      );
      expect(
        document.querySelector(".MuiDialog-paperFullScreen")
      ).toBeInTheDocument();
      expect(screen.getByLabelText("restore")).toBeInTheDocument();
    });

    it("ignores defaultMaximized when maximizable is false", () => {
      render(
        <Modal {...defaultProps} title="Title" defaultMaximized>
          <p>Content</p>
        </Modal>
      );
      expect(
        document.querySelector(".MuiDialog-paperFullScreen")
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText("restore")).not.toBeInTheDocument();
    });

    it("does not render the maximize button when neither title nor close button are present", () => {
      // Without a header (no title, no close button) there is nowhere to
      // anchor the toggle — suppressed for layout consistency.
      render(
        <Modal {...defaultProps} maximizable showCloseButton={false}>
          <p>Content</p>
        </Modal>
      );
      expect(screen.queryByLabelText("maximize")).not.toBeInTheDocument();
    });

    it("still calls onClose from the close button while maximized", async () => {
      render(
        <Modal {...defaultProps} title="Title" maximizable defaultMaximized>
          <p>Content</p>
        </Modal>
      );
      await userEvent.click(screen.getByLabelText("close"));
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it("resets to its initial maximized state when the modal is closed and reopened", () => {
      // Closing unmounts the dialog content (MUI default), which discards
      // local state, so the next open cycle starts from `defaultMaximized`.
      const { rerender } = render(
        <Modal {...defaultProps} title="Title" maximizable>
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByLabelText("maximize")).toBeInTheDocument();

      rerender(
        <Modal {...defaultProps} open={false} title="Title" maximizable>
          <p>Content</p>
        </Modal>
      );
      rerender(
        <Modal {...defaultProps} title="Title" maximizable>
          <p>Content</p>
        </Modal>
      );
      expect(screen.getByLabelText("maximize")).toBeInTheDocument();
      expect(screen.queryByLabelText("restore")).not.toBeInTheDocument();
    });
  });

  // A form dialog's actions are type="button" (they'd double-fire as submit
  // buttons), and a form with no submit button and more than one text field
  // doesn't submit on Enter. The Modal supplies the default button.
  describe("Enter submits a form dialog", () => {
    const FormModal = ({
      onSubmit,
      submitDisabled = false,
      pending = false,
      onClose = defaultProps.onClose,
      children,
    }: {
      onSubmit: () => void;
      submitDisabled?: boolean;
      pending?: boolean;
      onClose?: () => void;
      children?: React.ReactNode;
    }) => (
      <Modal
        open
        onClose={onClose}
        title="Form"
        onSubmit={onSubmit}
        submitDisabled={submitDisabled}
        pending={pending}
        actions={
          <button type="button" onClick={onSubmit}>
            Save
          </button>
        }
      >
        <label>
          Name
          <input name="name" />
        </label>
        <label>
          Description
          <input name="description" />
        </label>
        {children}
      </Modal>
    );

    it("renders its paper as a form", () => {
      render(<FormModal onSubmit={jest.fn()} />);
      expect(screen.getByLabelText("Name").closest("form")).not.toBeNull();
    });

    it("does not submit on Enter while pending", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      render(<FormModal onSubmit={onSubmit} pending />);
      await user.type(screen.getByLabelText("Name"), "x{Enter}{Enter}");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    // #789: React bubbles a submit from a portaled child form (a nested
    // dialog or popover) through to this form's onSubmit. It isn't ours.
    it("ignores a submit bubbled from a portaled child form", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      const onChildSubmit = jest.fn();
      const Child = () =>
        ReactDOM.createPortal(
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onChildSubmit();
            }}
          >
            <input aria-label="child field" />
          </form>,
          document.body
        );
      render(
        <FormModal onSubmit={onSubmit}>
          <Child />
        </FormModal>
      );
      await user.type(screen.getByLabelText("child field"), "x{Enter}");
      expect(onChildSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("submits once when Enter is pressed in one of several text fields", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      render(<FormModal onSubmit={onSubmit} />);
      await user.type(screen.getByLabelText("Name"), "x{Enter}");
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    // While the visible submit is disabled (a request in flight, an invalid
    // form), Enter must not submit either: a disabled default button blocks
    // implicit submission.
    it("does not submit on Enter while submitDisabled", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      render(<FormModal onSubmit={onSubmit} submitDisabled />);
      await user.type(screen.getByLabelText("Name"), "x{Enter}{Enter}");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    // The dialog validates in its own onSubmit (Zod + field errors), as the
    // visible submit does, so Enter must skip the browser's native `required`
    // check (which shows a different message). That's `formnovalidate` on the
    // default button. jsdom ignores a submitter's formnovalidate (it only
    // reads the form's own novalidate), so this pins the attribute; the
    // behaviour is verified in a real browser.
    // #751: stopping a duplicate submit isn't Modal's job. The app's request
    // layer (`useAuthMutation`) drops a request already in flight, whatever
    // input produced it, so Modal passes every Enter through while its
    // submit is enabled.
    it("passes each Enter to onSubmit while submit is enabled", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      render(<FormModal onSubmit={onSubmit} />);
      await user.type(screen.getByLabelText("Name"), "x{Enter}{Enter}");
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });

    it("the default button skips native validation (formnovalidate)", () => {
      render(<FormModal onSubmit={jest.fn()} />);
      expect(document.querySelector('button[type="submit"]')).toHaveAttribute(
        "formnovalidate"
      );
    });

    // A focused button owns Enter: the browser clicks it, and implicit
    // submission only comes from text fields, so the dialog doesn't submit.
    it("Enter on a focused secondary button runs that button, not submit", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      const onAddRow = jest.fn();
      render(
        <FormModal onSubmit={onSubmit}>
          <button type="button" onClick={onAddRow}>
            Add row
          </button>
        </FormModal>
      );
      screen.getByRole("button", { name: "Add row" }).focus();
      await user.keyboard("{Enter}");
      expect(onAddRow).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("Enter on a focused Cancel cancels without submitting", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      const onCancel = jest.fn();
      render(
        <Modal
          open
          onClose={onCancel}
          title="Form"
          onSubmit={onSubmit}
          submitDisabled={false}
          pending={false}
          actions={
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          }
        >
          <input aria-label="Name" />
        </Modal>
      );
      screen.getByRole("button", { name: "Cancel" }).focus();
      await user.keyboard("{Enter}");
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    // Browsers submit a form on Enter in a checkbox or radio (implicit
    // submission), without toggling it. A focused control that isn't a text
    // field owns Enter, so the dialog doesn't submit from one.
    it.each(["checkbox", "radio"])(
      "Enter on a focused %s doesn't submit",
      async (type) => {
        const user = userEvent.setup();
        const onSubmit = jest.fn();
        render(
          <FormModal onSubmit={onSubmit}>
            <input type={type} aria-label="Choice" />
          </FormModal>
        );
        screen.getByLabelText("Choice").focus();
        await user.keyboard("{Enter}");
        expect(onSubmit).not.toHaveBeenCalled();
      }
    );

    it("Enter on the focused close button closes without submitting", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      const onClose = jest.fn();
      render(<FormModal onSubmit={onSubmit} onClose={onClose} />);
      screen.getByRole("button", { name: /close/i }).focus();
      await user.keyboard("{Enter}");
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("clicking the visible action still fires once", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      render(<FormModal onSubmit={onSubmit} />);
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("adds no submit control to a dialog that isn't a form", () => {
      render(
        <Modal {...defaultProps} title="Plain">
          <input aria-label="field" />
        </Modal>
      );
      expect(document.querySelector('button[type="submit"]')).toBeNull();
    });

    it("keeps the default button out of the accessibility tree and tab order", () => {
      render(<FormModal onSubmit={jest.fn()} />);
      const submit = document.querySelector('button[type="submit"]');
      expect(submit).not.toBeNull();
      expect(submit).toHaveAttribute("aria-hidden", "true");
      expect(submit).toHaveAttribute("tabindex", "-1");
      expect(screen.getAllByRole("button")).not.toContain(submit);
    });
  });

  // #789: a dialog whose request is in flight can't be dismissed. Cancel is
  // disabled by its caller; Modal blocks the rest, so the dialog stays up to
  // show the outcome (success closes it, a failure lands in its FormAlert).
  describe("dismissal while pending", () => {
    const renderPending = (pending: boolean, onClose = jest.fn()) => {
      render(
        <Modal
          open
          onClose={onClose}
          title="Saving"
          onSubmit={jest.fn()}
          submitDisabled={false}
          pending={pending}
        >
          <input aria-label="field" />
        </Modal>
      );
      return onClose;
    };

    it("Escape does not close while pending", async () => {
      const user = userEvent.setup();
      const onClose = renderPending(true);
      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
    });

    it("Escape closes when not pending", async () => {
      const user = userEvent.setup();
      const onClose = renderPending(false);
      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("a backdrop click does not close while pending", async () => {
      const user = userEvent.setup();
      const onClose = renderPending(true);
      const backdrop = document.querySelector(".MuiBackdrop-root");
      expect(backdrop).not.toBeNull();
      await user.click(backdrop as Element);
      expect(onClose).not.toHaveBeenCalled();
    });

    it("disables the close button while pending", () => {
      renderPending(true);
      expect(screen.getByLabelText("close")).toBeDisabled();
    });

    it("blocks dismissal for a plain (non-form) Modal that is pending", async () => {
      const user = userEvent.setup();
      const onClose = jest.fn();
      render(
        <Modal open onClose={onClose} title="Committing" pending>
          <p>Working</p>
        </Modal>
      );
      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByLabelText("close")).toBeDisabled();
    });

    it("a caller can't replace the guarded onClose through spread props", async () => {
      const user = userEvent.setup();
      const onClose = jest.fn();
      const props = { onClose } as Record<string, unknown>;
      render(
        <Modal
          open
          title="Saving"
          pending
          {...(props as { onClose: () => void })}
        >
          <p>Working</p>
        </Modal>
      );
      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  // #789: an Escape that something inside the dialog already handled (the
  // region editor deselecting a region) doesn't also close the dialog.
  describe("Escape handled inside the dialog", () => {
    it("does not close when a capture listener prevented the Escape", async () => {
      const user = userEvent.setup();
      const onClose = jest.fn();
      const handle = (e: KeyboardEvent) => {
        if (e.key === "Escape") e.preventDefault();
      };
      document.addEventListener("keydown", handle, { capture: true });
      try {
        render(
          <Modal open onClose={onClose} title="Editor">
            <p>Canvas</p>
          </Modal>
        );
        await user.keyboard("{Escape}");
        expect(onClose).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener("keydown", handle, { capture: true });
      }
    });
  });

  // #789: blur handlers read these to tell a move toward the dialog's own
  // controls (Cancel, the close X) from a move to another field.
  describe("control markers", () => {
    it("marks the actions and the header controls", () => {
      render(
        <Modal
          open
          onClose={jest.fn()}
          title="Marked"
          actions={<button type="button">Cancel</button>}
        >
          <p>Body</p>
        </Modal>
      );
      expect(
        screen
          .getByRole("button", { name: "Cancel" })
          .closest("[data-dialog-controls]")
      ).not.toBeNull();
      expect(
        screen.getByLabelText("close").closest("[data-dialog-controls]")
      ).not.toBeNull();
    });
  });
});
