import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusMessage } from "../../ui/StatusMessage";

describe("StatusMessage Component", () => {
  describe("Rendering", () => {
    it("should render info variant with message", () => {
      render(<StatusMessage message="Information" />);
      expect(screen.getByText("Information")).toBeInTheDocument();
    });

    it("should render warning variant with message", () => {
      render(<StatusMessage variant="warning" message="Warning occurred" />);
      expect(screen.getByText("Warning occurred")).toBeInTheDocument();
    });

    it("should render error variant with message", () => {
      render(<StatusMessage variant="error" message="Something failed" />);
      expect(screen.getByText("Something failed")).toBeInTheDocument();
    });

    it("should render success variant with message", () => {
      render(<StatusMessage variant="success" message="Operation completed" />);
      expect(screen.getByText("Operation completed")).toBeInTheDocument();
    });

    it("should show loading spinner when loading is true", () => {
      render(<StatusMessage loading message="Loading data" />);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      expect(screen.getByText("Loading data")).toBeInTheDocument();
    });

    it("should fall back to error.message when no message prop", () => {
      render(
        <StatusMessage variant="error" error={new Error("Network error")} />
      );
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });

    it("should prefer message over error.message when both provided", () => {
      render(
        <StatusMessage
          variant="error"
          message="Custom message"
          error={new Error("Network error")}
        />
      );
      expect(screen.getByText("Custom message")).toBeInTheDocument();
      expect(screen.queryByText("Network error")).not.toBeInTheDocument();
    });

    it("should render with no text when no message or error provided", () => {
      const { container } = render(<StatusMessage />);
      expect(container.querySelector("svg")).toBeInTheDocument();
      expect(container.querySelector("p")).not.toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the underlying div element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<StatusMessage ref={ref} message="Ref test" />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe("Custom Props", () => {
    it("should accept custom className", () => {
      const { container } = render(
        <StatusMessage className="custom-class" message="Test" />
      );
      expect(container.firstChild).toHaveClass("custom-class");
    });

    it("should accept custom data attributes", () => {
      render(<StatusMessage data-testid="status-msg" message="Test" />);
      expect(screen.getByTestId("status-msg")).toBeInTheDocument();
    });
  });

  describe("Tooltip", () => {
    it("should show tooltip on hover when tooltip prop is provided", async () => {
      render(<StatusMessage message="Hover me" tooltip="Extra details" />);
      await userEvent.hover(screen.getByText("Hover me"));
      await waitFor(() => {
        expect(screen.getByRole("tooltip")).toHaveTextContent("Extra details");
      });
    });

    it("should not render tooltip when tooltip prop is not provided", () => {
      render(<StatusMessage message="No tooltip" />);
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });
});
