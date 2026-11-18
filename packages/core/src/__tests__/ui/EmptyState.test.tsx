import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { EmptyState } from "../../ui/EmptyState";
import { expectNoAxeViolations } from "../axe.util";

describe("EmptyState Component", () => {
  describe("Rendering", () => {
    it("should render the title", () => {
      render(<EmptyState title="No stations found" />);
      expect(screen.getByText("No stations found")).toBeInTheDocument();
    });

    it("should render the description when provided", () => {
      render(
        <EmptyState
          title="No stations found"
          description="Create your first station to get started."
        />
      );
      expect(
        screen.getByText("Create your first station to get started.")
      ).toBeInTheDocument();
    });

    it("should not render a description when not provided", () => {
      const { container } = render(<EmptyState title="No stations found" />);
      // Only the title text node should exist
      const paragraphs = container.querySelectorAll("p");
      // MUI Typography renders as p for body2; h6 title is not a p
      expect(paragraphs).toHaveLength(0);
    });

    it("should render the icon when provided", () => {
      render(
        <EmptyState
          title="No results"
          icon={<span data-testid="empty-icon">ic</span>}
        />
      );
      expect(screen.getByTestId("empty-icon")).toBeInTheDocument();
    });

    it("should not render an icon container when icon is not provided", () => {
      render(<EmptyState title="No results" />);
      expect(screen.queryByTestId("empty-icon")).not.toBeInTheDocument();
      // The title should still render
      expect(screen.getByText("No results")).toBeInTheDocument();
    });

    it("should render the action when provided", () => {
      render(
        <EmptyState
          title="No stations found"
          action={<button>Create Station</button>}
        />
      );
      expect(
        screen.getByRole("button", { name: "Create Station" })
      ).toBeInTheDocument();
    });

    it("should not render the action slot when action is not provided", () => {
      render(<EmptyState title="No results" />);
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("should render all slots together", () => {
      render(
        <EmptyState
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
        <EmptyState
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
        <EmptyState title="Empty" className="custom-empty" />
      );
      expect(container.firstChild).toHaveClass("custom-empty");
    });

    it("should accept custom data attributes", () => {
      render(<EmptyState title="Empty" data-testid="empty-state" />);
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the root element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<EmptyState ref={ref} title="Empty" />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  // #1059: an empty list explains itself and links to its Help entry, in one
  // order on every page: title, sentence, link.
  describe("help link", () => {
    const Anchor = React.forwardRef<
      HTMLAnchorElement,
      React.AnchorHTMLAttributes<HTMLAnchorElement>
    >((props, ref) => <a ref={ref} data-router-link="" {...props} />);
    Anchor.displayName = "Anchor";

    it("renders title, sentence, then the Help link, in that order", () => {
      const { container } = render(
        <EmptyState
          title="No tags found"
          description="Tags are labels you attach to entities."
          helpLink={{
            href: "/help#faq-entry-how-do-tags-work",
            label: "How do tags work?",
          }}
          linkComponent={Anchor}
        />
      );
      const link = screen.getByRole("link", {
        name: "Help: How do tags work?",
      });
      expect(link).toHaveAttribute("href", "/help#faq-entry-how-do-tags-work");
      expect(link).toHaveAttribute("data-router-link");
      const text = container.textContent ?? "";
      expect(text.indexOf("No tags found")).toBeLessThan(
        text.indexOf("Tags are labels")
      );
      expect(text.indexOf("Tags are labels")).toBeLessThan(
        text.indexOf("Help: How do tags work?")
      );
    });

    it("falls back to a plain anchor without a linkComponent", () => {
      render(
        <EmptyState
          title="No tags found"
          helpLink={{ href: "/help", label: "How do tags work?" }}
        />
      );
      expect(
        screen.getByRole("link", { name: "Help: How do tags work?" })
      ).toHaveAttribute("href", "/help");
    });

    it("renders no link without helpLink", () => {
      render(<EmptyState title="No tags found" />);
      expect(screen.queryByRole("link")).toBeNull();
    });

    it("has no axe violations with a help link", async () => {
      const { container } = render(
        <EmptyState
          title="No tags found"
          description="Tags are labels you attach to entities."
          helpLink={{ href: "/help", label: "How do tags work?" }}
        />
      );
      await expectNoAxeViolations(container);
    });
  });

  // #794: an empty page's title sits directly under the page's h1.
  it("renders its title as an h2", () => {
    render(<EmptyState title="No stations yet" />);
    expect(
      screen.getByRole("heading", { level: 2, name: "No stations yet" })
    ).toBeInTheDocument();
  });
  it("has no axe violations", async () => {
    const { container } = render(
      <EmptyState
        title="Nothing here"
        description="Add some items to see them listed."
        icon={<span>ic</span>}
        action={<button>Add Item</button>}
      />
    );
    await expectNoAxeViolations(container);
  });
});
