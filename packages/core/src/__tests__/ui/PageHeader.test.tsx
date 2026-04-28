import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { PageHeader } from "../../ui/PageHeader";

describe("PageHeader Component", () => {
  describe("Rendering", () => {
    it("should render the title", () => {
      render(<PageHeader title="Stations" />);
      expect(
        screen.getByRole("heading", { name: "Stations", level: 1 })
      ).toBeInTheDocument();
    });

    it("should render breadcrumbs when provided", () => {
      render(
        <PageHeader
          title="Details"
          breadcrumbs={[{ label: "Home", href: "/" }, { label: "Details" }]}
        />
      );
      expect(
        screen.getByRole("navigation", { name: "breadcrumb" })
      ).toBeInTheDocument();
      expect(screen.getByText("Home")).toBeInTheDocument();
    });

    it("should not render breadcrumbs when not provided", () => {
      render(<PageHeader title="Dashboard" />);
      expect(
        screen.queryByRole("navigation", { name: "breadcrumb" })
      ).not.toBeInTheDocument();
    });

    it("should not render breadcrumbs when the array is empty", () => {
      render(<PageHeader title="Dashboard" breadcrumbs={[]} />);
      expect(
        screen.queryByRole("navigation", { name: "breadcrumb" })
      ).not.toBeInTheDocument();
    });

    it("should render the icon when provided", () => {
      render(
        <PageHeader
          title="Stations"
          icon={<span data-testid="page-icon">icon</span>}
        />
      );
      expect(screen.getByTestId("page-icon")).toBeInTheDocument();
    });

    it("should not render an icon container when icon is not provided", () => {
      const { container } = render(<PageHeader title="Stations" />);
      // Only the title text should appear — no extra wrapper for an icon
      const h1 = container.querySelector("h1");
      expect(h1).toBeInTheDocument();
      expect(screen.queryByTestId("page-icon")).not.toBeInTheDocument();
    });

    it("should render the primary action", () => {
      render(
        <PageHeader title="Stations" primaryAction={<button>Create</button>} />
      );
      expect(
        screen.getByRole("button", { name: "Create" })
      ).toBeInTheDocument();
    });

    it("should render the secondary actions menu trigger", () => {
      render(
        <PageHeader
          title="Stations"
          secondaryActions={[{ label: "Edit", onClick: () => {} }]}
        />
      );
      expect(
        screen.getByRole("button", { name: "More actions" })
      ).toBeInTheDocument();
    });

    it("should not render the actions menu when secondaryActions is an empty array", () => {
      render(<PageHeader title="Stations" secondaryActions={[]} />);
      expect(
        screen.queryByRole("button", { name: "More actions" })
      ).not.toBeInTheDocument();
    });

    it("should render children content below the title", () => {
      render(
        <PageHeader title="Stations">
          <p>Some metadata</p>
        </PageHeader>
      );
      expect(screen.getByText("Some metadata")).toBeInTheDocument();
    });

    it("should not render children container when children is not provided", () => {
      const { container } = render(<PageHeader title="Stations" />);
      // Only the title heading should exist
      expect(container.querySelectorAll("h1")).toHaveLength(1);
    });
  });

  describe("Interactions", () => {
    it("should open the secondary actions menu and show items on click", async () => {
      const handleEdit = jest.fn();
      render(
        <PageHeader
          title="Stations"
          secondaryActions={[
            { label: "Edit", onClick: handleEdit },
            { label: "Delete", onClick: () => {} },
          ]}
        />
      );

      await userEvent.click(
        screen.getByRole("button", { name: "More actions" })
      );

      expect(
        screen.getByRole("menuitem", { name: "Edit" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", { name: "Delete" })
      ).toBeInTheDocument();
    });

    it("should call the item onClick and close the menu when a menu item is clicked", async () => {
      const handleEdit = jest.fn();
      render(
        <PageHeader
          title="Stations"
          secondaryActions={[{ label: "Edit", onClick: handleEdit }]}
        />
      );

      await userEvent.click(
        screen.getByRole("button", { name: "More actions" })
      );
      await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));

      expect(handleEdit).toHaveBeenCalledTimes(1);
      // Menu should close after click
      expect(
        screen.queryByRole("menuitem", { name: "Edit" })
      ).not.toBeInTheDocument();
    });

    it("should call onNavigate when a breadcrumb is clicked", async () => {
      const handleNavigate = jest.fn();
      render(
        <PageHeader
          title="Details"
          breadcrumbs={[{ label: "Home", href: "/" }, { label: "Details" }]}
          onNavigate={handleNavigate}
        />
      );

      await userEvent.click(screen.getByText("Home"));

      expect(handleNavigate).toHaveBeenCalledTimes(1);
      expect(handleNavigate).toHaveBeenCalledWith("/", expect.any(Object));
    });
  });

  describe("Props", () => {
    it("should accept a custom className", () => {
      const { container } = render(
        <PageHeader title="Stations" className="custom-header" />
      );
      expect(container.firstChild).toHaveClass("custom-header");
    });

    it("should accept custom data attributes", () => {
      render(<PageHeader title="Stations" data-testid="page-header" />);
      expect(screen.getByTestId("page-header")).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the root element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<PageHeader ref={ref} title="Stations" />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });
});
