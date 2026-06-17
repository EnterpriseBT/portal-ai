import React from "react";
import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

jest.unstable_mockModule("react-markdown", () => ({
  default: ({ children }: { children: string }) => (
    <span data-testid="markdown">{children}</span>
  ),
}));

// Capture the props handed to VegaLite so the wrapper-shape tests
// can assert the spec + data prop forwarding.
const vegaLiteCalls: Array<{ spec: unknown; data: unknown }> = [];
jest.unstable_mockModule("react-vega", () => ({
  VegaLite: (props: { spec: unknown; data?: unknown }) => {
    vegaLiteCalls.push({ spec: props.spec, data: props.data });
    return <div data-testid="vega-lite-chart" />;
  },
  Vega: () => <div data-testid="vega-chart" />,
}));

jest.unstable_mockModule("remark-gfm", () => ({ default: () => {} }));

const { ContentBlockRenderer, registerBlockRenderer, hasBlockRenderer } =
  await import("../../ui/ContentBlockRenderer");

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
    vegaLiteCalls.length = 0;
    render(
      <ContentBlockRenderer
        block={{ type: "vega-lite", content: { mark: "bar" } }}
      />
    );
    expect(await screen.findByTestId("vega-lite-chart")).toBeInTheDocument();
  });

  // #109: vega-lite block content can carry `{ spec, datasets }` —
  // the spec keeps a `data: { name: "primary" }` reference while the
  // datasets sidecar holds the actual rows. The renderer must hand
  // the spec to VegaLite and forward the datasets via its `data`
  // prop so react-vega's named-dataset binding fires.
  it("forwards spec + datasets via react-vega's data prop for wrapped vega-lite blocks", async () => {
    vegaLiteCalls.length = 0;
    const spec = { mark: "circle", data: { name: "primary" } };
    const datasets = { primary: [{ x: 1 }, { x: 2 }] };
    render(
      <ContentBlockRenderer
        block={{ type: "vega-lite", content: { spec, datasets } }}
      />
    );
    expect(await screen.findByTestId("vega-lite-chart")).toBeInTheDocument();
    expect(vegaLiteCalls).toHaveLength(1);
    expect(vegaLiteCalls[0].spec).toEqual(spec);
    expect(vegaLiteCalls[0].data).toEqual(datasets);
  });

  // Bare-spec content (the inline ≤100-row path) hands the entire
  // content to VegaLite as the spec — no `data` prop because the
  // rows are already baked into `spec.data.values`.
  it("renders bare vega-lite content as the spec with no data prop", async () => {
    vegaLiteCalls.length = 0;
    const inlineSpec = {
      mark: "bar",
      data: { values: [{ x: 1 }] },
    };
    render(
      <ContentBlockRenderer block={{ type: "vega-lite", content: inlineSpec }} />
    );
    expect(await screen.findByTestId("vega-lite-chart")).toBeInTheDocument();
    expect(vegaLiteCalls).toHaveLength(1);
    expect(vegaLiteCalls[0].spec).toEqual(inlineSpec);
    expect(vegaLiteCalls[0].data).toBeUndefined();
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

// #121 child H: the dispatch is an open registry — new formats register a
// renderer with no edit to the central switch.
describe("registerBlockRenderer", () => {
  it("renders a newly registered block type with no central-switch edit", () => {
    registerBlockRenderer("custom-test-block", (b) => (
      <div data-testid="custom-test">
        {String((b.content as { label: string }).label)}
      </div>
    ));
    expect(hasBlockRenderer("custom-test-block")).toBe(true);
    render(
      <ContentBlockRenderer
        block={{ type: "custom-test-block", content: { label: "hi" } }}
      />
    );
    expect(screen.getByTestId("custom-test")).toHaveTextContent("hi");
  });

  it("hasBlockRenderer is false for an unregistered type", () => {
    expect(hasBlockRenderer("never-registered-xyz")).toBe(false);
  });

  it("a later registration overrides an earlier one for the same type", () => {
    registerBlockRenderer("override-test", () => <div data-testid="v1" />);
    registerBlockRenderer("override-test", () => <div data-testid="v2" />);
    render(
      <ContentBlockRenderer block={{ type: "override-test", content: null }} />
    );
    expect(screen.getByTestId("v2")).toBeInTheDocument();
    expect(screen.queryByTestId("v1")).not.toBeInTheDocument();
  });
});
