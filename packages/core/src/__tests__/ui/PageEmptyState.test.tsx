import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { PageEmptyState } from "../../ui/PageEmptyState";

describe("PageEmptyState Component", () => {
  describe("Rendering", () => {
    it("should render the title", () => {
      render(<PageEmptyState title="No stations found" />);
      expect(screen.getByText("No stations found")).toBeInTheDocument();
    });

    it("should render the description when provided", () => {
      render(
        <PageEmptyState
          title="No stations found"
          description="Create your first station to get started."
        />
      );
      expect(
        screen.getByText("Create your first station to get started.")
      ).toBeInTheDocument();
    });

    it("should not render a description when not provided", () => {
      const { container } = render(
        <PageEmptyState title="No stations found" />
      );
      // Only the title text node should exist
      const paragraphs = container.querySelectorAll("p");
      // MUI Typography renders as p for body2; h6 title is not a p
      expect(paragraphs).toHaveLength(0);
    });

    it("should render the icon when provided", () => {
      render(
        <PageEmptyState
          title="No results"
          icon={<span data-testid="empty-icon">ic</span>}
        />
      );
      expect(screen.getByTestId("empty-icon")).toBeInTheDocument();
    });

    it("should not render an icon container when icon is not provided", () => {
      const { container } = render(<PageEmptyState title="No results" />);
      expect(screen.queryByTestId("empty-icon")).not.toBeInTheDocument();
      // The title should still render
      expect(screen.getByText("No results")).toBeInTheDocument();
    });

    it("should render the action when provided", () => {
      render(
        <PageEmptyState
          title="No stations found"
          action={<button>Create Station</button>}
        />
      );
      expect(
        screen.getByRole("button", { name: "Create Station" })
      ).toBeInTheDocument();
    });

    it("should not render the action slot when action is not provided", () => {
      render(<PageEmptyState title="No results" />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("should render all slots together", () => {
      render(
        <PageEmptyState
          title="Nothing here"
          description="Add some items to see them listed."
          icon={<span data-testid="all-icon">ic</span>}
          action={<button>Add Item</button>}
        />
      );
      expect(screen.getByTestId("all-icon")).toBeInTheDocument();
      expect(screen.getByText("Nothing here")).toBeInTheDocument();
      expect(
        screen.getByText("Add some items to see them listed.")
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Add Item" })
      ).toBeInTheDocument();
    });
  });

  describe("Interactions", () => {
    it("should support clicking the action button", async () => {
      const handleClick = jest.fn();
      render(
        <PageEmptyState
          title="Empty"
          action={<button onClick={handleClick}>Retry</button>}
        />
      );
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(handleClick).toHaveBeenCalledTimes(1);
    });
  });

  describe("Props", () => {
    it("should accept a custom className", () => {
      const { container } = render(
        <PageEmptyState title="Empty" className="custom-empty" />
      );
      expect(container.firstChild).toHaveClass("custom-empty");
    });

    it("should accept custom data attributes", () => {
      render(<PageEmptyState title="Empty" data-testid="empty-state" />);
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the root element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<PageEmptyState ref={ref} title="Empty" />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });
});
