import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Breadcrumbs } from "../../ui/Breadcrumbs";
import { jest } from "@jest/globals";

describe("Breadcrumbs Component", () => {
  const items = [
    { label: "Home", href: "/" },
    { label: "Products", href: "/products" },
    { label: "Widget" },
  ];

  describe("Rendering", () => {
    it("should render all breadcrumb items", () => {
      render(<Breadcrumbs items={items} />);
      expect(screen.getByText("Home")).toBeInTheDocument();
      expect(screen.getByText("Products")).toBeInTheDocument();
      expect(screen.getByText("Widget")).toBeInTheDocument();
    });

    it("should render links for items with href", () => {
      render(<Breadcrumbs items={items} />);
      const homeLink = screen.getByText("Home").closest("a");
      expect(homeLink).toHaveAttribute("href", "/");
      const productsLink = screen.getByText("Products").closest("a");
      expect(productsLink).toHaveAttribute("href", "/products");
    });

    it("should render the last item as plain text, not a link", () => {
      render(<Breadcrumbs items={items} />);
      const widget = screen.getByText("Widget");
      expect(widget.closest("a")).toBeNull();
    });

    it("should render a single item as plain text", () => {
      render(<Breadcrumbs items={[{ label: "Home" }]} />);
      const home = screen.getByText("Home");
      expect(home.closest("a")).toBeNull();
    });

    it("should have aria-label for accessibility", () => {
      render(<Breadcrumbs items={items} />);
      expect(screen.getByLabelText("breadcrumb")).toBeInTheDocument();
    });
  });

  describe("Navigation", () => {
    it("should call onNavigate with href when a link is clicked", () => {
      const onNavigate = jest.fn();
      render(<Breadcrumbs items={items} onNavigate={onNavigate} />);
      fireEvent.click(screen.getByText("Home"));
      expect(onNavigate).toHaveBeenCalledWith("/", expect.any(Object));
    });

    it("should not call onNavigate when the last item is clicked", () => {
      const onNavigate = jest.fn();
      render(<Breadcrumbs items={items} onNavigate={onNavigate} />);
      fireEvent.click(screen.getByText("Widget"));
      expect(onNavigate).not.toHaveBeenCalled();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the nav element", () => {
      const ref = React.createRef<HTMLElement>();
      render(<Breadcrumbs ref={ref} items={items} />);
      expect(ref.current).toBeInstanceOf(HTMLElement);
      expect(ref.current?.tagName).toBe("NAV");
    });
  });

  describe("Custom Props", () => {
    it("should accept custom className", () => {
      const { container } = render(
        <Breadcrumbs className="custom-class" items={items} />
      );
      expect(container.firstChild).toHaveClass("custom-class");
    });

    it("should accept custom data attributes", () => {
      render(<Breadcrumbs data-testid="my-breadcrumbs" items={items} />);
      expect(screen.getByTestId("my-breadcrumbs")).toBeInTheDocument();
    });

    it("should use custom separator", () => {
      const { container } = render(<Breadcrumbs items={items} separator=">" />);
      expect(container.textContent).toContain(">");
    });
  });
});
