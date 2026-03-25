import React from "react";
import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

jest.unstable_mockModule("react-markdown", () => ({
  default: ({ children }: { children: string }) => <span data-testid="markdown">{children}</span>,
}));

jest.unstable_mockModule("react-vega", () => ({
  VegaLite: () => <div data-testid="vega-lite-chart" />,
}));

jest.unstable_mockModule("remark-gfm", () => ({ default: () => {} }));

const { ContentBlockRenderer } = await import("../../ui/ContentBlockRenderer");

describe("ContentBlockRenderer", () => {
  it("renders text block via ReactMarkdown", () => {
    render(<ContentBlockRenderer block={{ type: "text", content: "Hello world" }} />);
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
    render(<ContentBlockRenderer block={{ type: "vega-lite", content: { mark: "bar" } }} />);
    expect(await screen.findByTestId("vega-lite-chart")).toBeInTheDocument();
  });

  it("renders nothing for unknown block types", () => {
    const { container } = render(
      <ContentBlockRenderer block={{ type: "unknown", content: "data" }} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
