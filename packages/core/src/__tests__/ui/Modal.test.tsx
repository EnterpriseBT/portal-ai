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
});
