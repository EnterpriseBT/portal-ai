import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MetadataList } from "../../ui/MetadataList";
import type { MetadataItem } from "../../ui/MetadataList";

const baseItems: MetadataItem[] = [
  { label: "ID", value: "abc-123", variant: "mono" },
  { label: "Name", value: "Acme Corp" },
  { label: "Status", value: "Active", variant: "chip" },
];

describe("MetadataList", () => {
  describe("Rendering", () => {
    it("should render all visible items", () => {
      render(<MetadataList items={baseItems} />);
      expect(screen.getByText("ID")).toBeInTheDocument();
      expect(screen.getByText("abc-123")).toBeInTheDocument();
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Acme Corp")).toBeInTheDocument();
      expect(screen.getByText("Status")).toBeInTheDocument();
      expect(screen.getByText("Active")).toBeInTheDocument();
    });

    it("should render the data-testid attribute", () => {
      render(<MetadataList items={baseItems} />);
      expect(screen.getByTestId("metadata-list")).toBeInTheDocument();
    });

    it("should render nothing for an empty items array", () => {
      render(<MetadataList items={[]} />);
      const list = screen.getByTestId("metadata-list");
      expect(list.children).toHaveLength(0);
    });
  });

  describe("Hidden items", () => {
    it("should not render items with hidden=true", () => {
      const items: MetadataItem[] = [
        { label: "Visible", value: "yes" },
        { label: "Hidden", value: "no", hidden: true },
      ];
      render(<MetadataList items={items} />);
      expect(screen.getByText("Visible")).toBeInTheDocument();
      expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    });
  });

  describe("Variant rendering", () => {
    it("should render mono variant with monospace font", () => {
      render(
        <MetadataList
          items={[{ label: "Key", value: "some_key", variant: "mono" }]}
        />
      );
      const monoEl = screen.getByText("some_key");
      expect(monoEl).toHaveStyle({ fontFamily: "monospace" });
    });

    it("should render chip variant as an MUI Chip for string values", () => {
      render(
        <MetadataList
          items={[{ label: "Type", value: "String", variant: "chip" }]}
        />
      );
      const chip = screen.getByText("String");
      expect(chip.closest(".MuiChip-root")).toBeInTheDocument();
    });

    it("should render chip variant with custom JSX as-is", () => {
      render(
        <MetadataList
          items={[
            {
              label: "Custom",
              value: <span data-testid="custom-chip">Custom node</span>,
              variant: "chip",
            },
          ]}
        />
      );
      expect(screen.getByTestId("custom-chip")).toBeInTheDocument();
    });

    it("should render text variant for string values", () => {
      render(
        <MetadataList items={[{ label: "Desc", value: "A description" }]} />
      );
      expect(screen.getByText("A description")).toBeInTheDocument();
    });

    it("should render text variant with custom JSX as-is", () => {
      render(
        <MetadataList
          items={[
            {
              label: "Link",
              value: <a href="#">Click me</a>,
            },
          ]}
        />
      );
      expect(screen.getByText("Click me")).toBeInTheDocument();
    });
  });

  describe("Layout modes", () => {
    it("should render inline layout with label and colon", () => {
      render(
        <MetadataList
          layout="inline"
          items={[{ label: "Job ID", value: "j-001" }]}
        />
      );
      expect(screen.getByText("Job ID:")).toBeInTheDocument();
      expect(screen.getByText("j-001")).toBeInTheDocument();
    });

    it("should render stacked layout with label and value", () => {
      render(
        <MetadataList
          layout="stacked"
          items={[{ label: "Source", value: "ext_123" }]}
        />
      );
      expect(screen.getByText("Source")).toBeInTheDocument();
      expect(screen.getByText("ext_123")).toBeInTheDocument();
    });

    it("should render responsive layout by default", () => {
      render(<MetadataList items={[{ label: "Name", value: "Test" }]} />);
      expect(screen.getByText("Name")).toBeInTheDocument();
      expect(screen.getByText("Test")).toBeInTheDocument();
    });
  });

  describe("Dividers", () => {
    it("should render dividers between items when dividers=true", () => {
      const { container } = render(<MetadataList dividers items={baseItems} />);
      const dividers = container.querySelectorAll("hr");
      // dividers appear between items, so count = items - 1
      expect(dividers).toHaveLength(baseItems.length - 1);
    });

    it("should not render dividers by default", () => {
      const { container } = render(<MetadataList items={baseItems} />);
      const dividers = container.querySelectorAll("hr");
      expect(dividers).toHaveLength(0);
    });
  });

  describe("Ref Forwarding", () => {
    it("should forward ref to the root element", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<MetadataList ref={ref} items={baseItems} />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    });
  });

  describe("Raised", () => {
    it("should wrap in an outlined Paper when raised=true", () => {
      const { container } = render(<MetadataList raised items={baseItems} />);
      expect(container.querySelector(".MuiPaper-outlined")).toBeInTheDocument();
    });

    it("should not wrap in Paper by default", () => {
      const { container } = render(<MetadataList items={baseItems} />);
      expect(
        container.querySelector(".MuiPaper-outlined")
      ).not.toBeInTheDocument();
    });

    it("should forward ref to Paper when raised", () => {
      const ref = React.createRef<HTMLDivElement>();
      render(<MetadataList ref={ref} raised items={baseItems} />);
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
      expect(ref.current?.classList.contains("MuiPaper-root")).toBe(true);
    });

    it("should forward className and data attributes to Paper when raised", () => {
      render(
        <MetadataList
          raised
          className="raised-meta"
          data-testid="raised-list"
          items={baseItems}
        />
      );
      const paper = screen.getByTestId("raised-list");
      expect(paper).toHaveClass("raised-meta");
      expect(paper.classList.contains("MuiPaper-root")).toBe(true);
    });

    it("should still render the metadata-list testid inside when raised", () => {
      render(<MetadataList raised items={baseItems} />);
      expect(screen.getByTestId("metadata-list")).toBeInTheDocument();
    });
  });

  describe("Custom Props", () => {
    it("should accept custom className", () => {
      const { container } = render(
        <MetadataList className="my-meta" items={baseItems} />
      );
      expect(container.firstChild).toHaveClass("my-meta");
    });

    it("should accept custom data attributes", () => {
      render(<MetadataList data-testid="custom-list" items={baseItems} />);
      expect(screen.getByTestId("custom-list")).toBeInTheDocument();
    });
  });
});
