import React from "react";
import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

jest.unstable_mockModule("react-markdown", () => ({
  default: ({ children }: { children: string }) => (
    <span data-testid="markdown">{children}</span>
  ),
}));

jest.unstable_mockModule("react-vega", () => ({
  VegaLite: () => <div data-testid="vega-lite-chart" />,
  Vega: () => <div data-testid="vega-chart" />,
}));

jest.unstable_mockModule("remark-gfm", () => ({ default: () => {} }));

const { ContentBlockRenderer } = await import("../../ui/ContentBlockRenderer");

describe("ContentBlockRenderer", () => {
  it("renders text block via ReactMarkdown", () => {
    render(
      <ContentBlockRenderer block={{ type: "text", content: "Hello world" }} />
    );
    const el = screen.getByTestId("markdown");
    expect(el).toBeInTheDocument();
    expect(el).toHaveTextContent("Hello world");
  });

  it("coerces non-string content to string for text blocks", () => {
    render(<ContentBlockRenderer block={{ type: "text", content: 42 }} />);
    expect(screen.getByTestId("markdown")).toHaveTextContent("42");
  });

  it("renders null content as empty string for text blocks", () => {
    render(<ContentBlockRenderer block={{ type: "text", content: null }} />);
    expect(screen.getByTestId("markdown")).toHaveTextContent("");
  });

  it("renders vega-lite block via VegaLite", async () => {
    render(
      <ContentBlockRenderer
        block={{ type: "vega-lite", content: { mark: "bar" } }}
      />
    );
    expect(await screen.findByTestId("vega-lite-chart")).toBeInTheDocument();
  });

  it("renders vega block via Vega", async () => {
    render(
      <ContentBlockRenderer
        block={{ type: "vega", content: { data: [], marks: [] } }}
      />
    );
    expect(await screen.findByTestId("vega-chart")).toBeInTheDocument();
  });

  it("renders data-table block via DataTableBlock", () => {
    render(
      <ContentBlockRenderer
        block={{
          type: "data-table",
          content: {
            columns: ["id", "name"],
            rows: [{ id: 1, name: "Alice" }],
          },
        }}
      />
    );
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders data-table block with null content gracefully", () => {
    const { container } = render(
      <ContentBlockRenderer block={{ type: "data-table", content: null }} />
    );
    // Should render an empty table (headers from empty columns array)
    expect(container.querySelector("table")).toBeInTheDocument();
  });

  it("renders nothing for unknown block types", () => {
    const { container } = render(
      <ContentBlockRenderer block={{ type: "unknown", content: "data" }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
