import React from "react";
import { render, screen } from "@testing-library/react";
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
      submitDisabled,
      open = true,
    }: {
      onSubmit: () => void;
      submitDisabled?: boolean;
      open?: boolean;
    }) => (
      <Modal
        {...defaultProps}
        open={open}
        title="Form"
        submitDisabled={submitDisabled}
        slotProps={{
          paper: {
            component: "form",
            onSubmit: (e: React.FormEvent) => {
              e.preventDefault();
              onSubmit();
            },
          } as object,
        }}
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
      </Modal>
    );

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

    // #747: a mutation's pending state renders a macrotask after `mutate()`
    // (react-query notifies on a timeout), so `submitDisabled` is still false
    // when a fast second Enter lands. Measured: a double Enter sent two
    // creates. The modal holds further submits until the dialog disables.
    it("submits once for two Enters before the dialog re-renders as pending", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      render(<FormModal onSubmit={onSubmit} />);
      await user.type(screen.getByLabelText("Name"), "x{Enter}{Enter}");
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    it("submits again once a pending submit has finished", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      const { rerender } = render(<FormModal onSubmit={onSubmit} />);
      await user.type(screen.getByLabelText("Name"), "x{Enter}");
      rerender(<FormModal onSubmit={onSubmit} submitDisabled />);
      rerender(<FormModal onSubmit={onSubmit} />);
      await user.type(screen.getByLabelText("Name"), "{Enter}");
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });

    // Review: a submit that closes the dialog straight away must not leave the
    // hold armed for the next time it opens.
    it("releases the hold when the dialog closes", async () => {
      const user = userEvent.setup();
      const onSubmit = jest.fn();
      const { rerender } = render(<FormModal onSubmit={onSubmit} />);
      await user.type(screen.getByLabelText("Name"), "x{Enter}");
      rerender(<FormModal onSubmit={onSubmit} open={false} />);
      rerender(<FormModal onSubmit={onSubmit} />);
      await user.type(screen.getByLabelText("Name"), "{Enter}");
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });

    // A submit that never disables the dialog (validation failed) must not
    // lock Enter out: the hold ends on its own.
    it("submits again after a short hold when the dialog never disabled", async () => {
      jest.useFakeTimers();
      try {
        const user = userEvent.setup({
          advanceTimers: jest.advanceTimersByTime,
        });
        const onSubmit = jest.fn();
        render(<FormModal onSubmit={onSubmit} />);
        await user.type(screen.getByLabelText("Name"), "x{Enter}");
        jest.advanceTimersByTime(500);
        await user.type(screen.getByLabelText("Name"), "{Enter}");
        expect(onSubmit).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    // The dialog validates in its own onSubmit (Zod + field errors), as the
    // visible submit does, so Enter must skip the browser's native `required`
    // check (which shows a different message). That's `formnovalidate` on the
    // default button. jsdom ignores a submitter's formnovalidate (it only
    // reads the form's own novalidate), so this pins the attribute; the
    // behaviour is verified in a real browser.
    it("the default button skips native validation (formnovalidate)", () => {
      render(<FormModal onSubmit={jest.fn()} />);
      expect(document.querySelector('button[type="submit"]')).toHaveAttribute(
        "formnovalidate"
      );
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
});
