import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { jest } from "@jest/globals";
import { PageSection } from "../../ui/PageSection";

describe("PageSection Component", () => {
  describe("Rendering", () => {
    it("should render children", () => {
      render(
        <PageSection>
          <p>Section body</p>
        </PageSection>,
      );
      expect(screen.getByText("Section body")).toBeInTheDocument();
    });

    it("should render the title as h2", () => {
      render(
        <PageSection title="Connectors">
          <p>Body</p>
        </PageSection>,
      );
      expect(
        screen.getByRole("heading", { name: "Connectors", level: 2 }),
      ).toBeInTheDocument();
    });

    it("should not render a heading when title is not provided", () => {
      render(
        <PageSection>
          <p>Body only</p>
        </PageSection>,
      );
      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    });

    it("should render the icon when provided", () => {
      render(
        <PageSection
          title="Connectors"
          icon={<span data-testid="section-icon">ic</span>}
        >
          <p>Body</p>
        </PageSection>,
      );
      expect(screen.getByTestId("section-icon")).toBeInTheDocument();
    });

    it("should render the primary action", () => {
      render(
        <PageSection
          title="Connectors"
          primaryAction={<button>Add</button>}
        >
          <p>Body</p>
        </PageSection>,
      );
      expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    });

    it("should render the secondary actions menu trigger", () => {
      render(
        <PageSection
          title="Connectors"
          secondaryActions={[{ label: "Export", onClick: () => {} }]}
        >
          <p>Body</p>
        </PageSection>,
      );
      expect(
        screen.getByRole("button", { name: "More actions" }),
      ).toBeInTheDocument();
    });

    it("should not render the actions menu when secondaryActions is empty", () => {
      render(
        <PageSection title="Connectors" secondaryActions={[]}>
          <p>Body</p>
        </PageSection>,
      );
      expect(
        screen.queryByRole("button", { name: "More actions" }),
      ).not.toBeInTheDocument();
    });

    it("should render a divider in divider variant when header is present", () => {
      const { container } = render(
        <PageSection title="Connectors" variant="divider">
          <p>Body</p>
        </PageSection>,
      );
      expect(container.querySelector("hr")).toBeInTheDocument();
    });

    it("should not render a divider in outlined variant", () => {
      const { container } = render(
        <PageSection title="Connectors" variant="outlined">
          <p>Body</p>
        </PageSection>,
      );
      expect(container.querySelector("hr")).not.toBeInTheDocument();
    });

    it("should wrap content in a Paper element for outlined variant", () => {
      const { container } = render(
        <PageSection title="Connectors" variant="outlined">
          <p>Body</p>
        </PageSection>,
      );
      expect(
        container.querySelector(".MuiPaper-outlined"),
      ).toBeInTheDocument();
    });

    it("should not wrap content in Paper for divider variant", () => {
      const { container } = render(
        <PageSection title="Connectors" variant="divider">
          <p>Body</p>
        </PageSection>,
      );
      expect(
        container.querySelector(".MuiPaper-outlined"),
      ).not.toBeInTheDocument();
    });

    it("should render actions without a title", () => {
      render(
        <PageSection primaryAction={<button>Create</button>}>
          <p>Body</p>
        </PageSection>,
      );
      expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    });
  });

  describe("Interactions", () => {
    it("should open the secondary actions menu and show items", async () => {
      const handleExport = jest.fn();
      render(
        <PageSection
          title="Connectors"
          secondaryActions={[
            { label: "Export", onClick: handleExport },
            { label: "Refresh", onClick: () => {} },
          ]}
        >
          <p>Body</p>
        </PageSection>,
      );

      await userEvent.click(screen.getByRole("button", { name: "More actions" }));

      expect(screen.getByRole("menuitem", { name: "Export" })).toBeInTheDocument();
      expect(screen.getByRole("menuitem", { name: "Refresh" })).toBeInTheDocument();
    });

    it("should call item onClick and close the menu on click", async () => {
      const handleExport = jest.fn();
      render(
        <PageSection
          title="Connectors"
          secondaryActions={[{ label: "Export", onClick: handleExport }]}
        >
          <p>Body</p>
        </PageSection>,
      );

      await userEvent.click(screen.getByRole("button", { name: "More actions" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "Export" }));

      expect(handleExport).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("menuitem", { name: "Export" })).not.toBeInTheDocument();
    });
  });

  describe("Props", () => {
    it("should accept a custom className", () => {
      const { container } = render(
        <PageSection className="custom-section">
          <p>Body</p>
        </PageSection>,
      );
      expect(container.firstChild).toHaveClass("custom-section");
    });

    it("should accept a custom className on outlined variant", () => {
      const { container } = render(
        <PageSection className="custom-section" variant="outlined">
          <p>Body</p>
        </PageSection>,
      );
      expect(container.firstChild).toHaveClass("custom-section");
    });

    it("should accept custom data attributes", () => {
      render(
        <PageSection data-testid="my-section">
          <p>Body</p>
        </PageSection>,
      );
      expect(screen.getByTestId("my-section")).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the root element in default variant", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(
        <PageSection ref={ref}>
          <p>Body</p>
        </PageSection>,
      );
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });

    it("should forward ref to the Paper element in outlined variant", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(
        <PageSection ref={ref} variant="outlined">
          <p>Body</p>
        </PageSection>,
      );
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
      expect(ref.current?.classList.contains("MuiPaper-outlined")).toBe(true);
    });
  });
});
