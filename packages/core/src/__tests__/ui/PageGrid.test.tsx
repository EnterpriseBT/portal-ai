import React from "react";
import { render, screen } from "@testing-library/react";
import { PageGrid, PageGridItem } from "../../ui/PageGrid";

describe("PageGrid Component", () => {
  describe("Rendering", () => {
    it("should render children", () => {
      render(
        <PageGrid>
          <div>Cell A</div>
          <div>Cell B</div>
        </PageGrid>,
      );
      expect(screen.getByText("Cell A")).toBeInTheDocument();
      expect(screen.getByText("Cell B")).toBeInTheDocument();
    });

    it("should apply display grid to the root element", () => {
      const { container } = render(
        <PageGrid>
          <div>Cell</div>
        </PageGrid>,
      );
      expect(container.firstChild).toHaveStyle({ display: "grid" });
    });
  });

  describe("Props", () => {
    it("should accept a custom className", () => {
      const { container } = render(
        <PageGrid className="custom-grid">
          <div>Cell</div>
        </PageGrid>,
      );
      expect(container.firstChild).toHaveClass("custom-grid");
    });

    it("should accept custom data attributes", () => {
      render(
        <PageGrid data-testid="my-grid">
          <div>Cell</div>
        </PageGrid>,
      );
      expect(screen.getByTestId("my-grid")).toBeInTheDocument();
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the root element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(
        <PageGrid ref={ref}>
          <div>Cell</div>
        </PageGrid>,
      );
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });
});

describe("PageGridItem Component", () => {
  describe("Rendering", () => {
    it("should render children", () => {
      render(
        <PageGridItem>
          <p>Item content</p>
        </PageGridItem>,
      );
      expect(screen.getByText("Item content")).toBeInTheDocument();
    });
  });

  describe("Props", () => {
    it("should accept a custom className", () => {
      const { container } = render(
        <PageGridItem className="custom-item">
          <p>Content</p>
        </PageGridItem>,
      );
      expect(container.firstChild).toHaveClass("custom-item");
    });

    it("should accept custom data attributes", () => {
      render(
        <PageGridItem data-testid="grid-item">
          <p>Content</p>
        </PageGridItem>,
      );
      expect(screen.getByTestId("grid-item")).toBeInTheDocument();
    });

    it("should apply gridColumn style when span is a number", () => {
      const { container } = render(
        <PageGridItem span={2}>
          <p>Content</p>
        </PageGridItem>,
      );
      expect(container.firstChild).toHaveStyle({ gridColumn: "span 2" });
    });

    it("should apply gridRow style when rowSpan is a number", () => {
      const { container } = render(
        <PageGridItem rowSpan={3}>
          <p>Content</p>
        </PageGridItem>,
      );
      expect(container.firstChild).toHaveStyle({ gridRow: "span 3" });
    });

    it("should apply both gridColumn and gridRow when both are provided", () => {
      const { container } = render(
        <PageGridItem span={2} rowSpan={3}>
          <p>Content</p>
        </PageGridItem>,
      );
      expect(container.firstChild).toHaveStyle({
        gridColumn: "span 2",
        gridRow: "span 3",
      });
    });

    it("should not apply grid styles when neither span nor rowSpan is provided", () => {
      const { container } = render(
        <PageGridItem>
          <p>Content</p>
        </PageGridItem>,
      );
      const el = container.firstChild as HTMLElement;
      // sx should not be set — no inline grid-column or grid-row
      expect(el.style.gridColumn).toBe("");
      expect(el.style.gridRow).toBe("");
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the root element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(
        <PageGridItem ref={ref}>
          <p>Content</p>
        </PageGridItem>,
      );
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });
});
