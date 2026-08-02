import React from "react";
import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

jest.unstable_mockModule("react-markdown", () => ({
  default: ({ children }: { children: string }) => (
    <span data-testid="markdown">{children}</span>
  ),
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

  // #272: Vega is removed. `vega-lite`/`vega` are no longer registered
  // block types — an unregistered type falls through to the central
  // dispatch's `null` (no crash, no renderer), same as any unknown type.
  it("renders nothing for a vega-lite block (renderer removed)", () => {
    const { container } = render(
      <ContentBlockRenderer
        block={{ type: "vega-lite", content: { mark: "bar" } }}
      />
    );
    expect(container).toBeEmptyDOMElement();
    expect(hasBlockRenderer("vega-lite")).toBe(false);
  });

  it("renders nothing for a vega block (renderer removed)", () => {
    const { container } = render(
      <ContentBlockRenderer
        block={{ type: "vega", content: { data: [], marks: [] } }}
      />
    );
    expect(container).toBeEmptyDOMElement();
    expect(hasBlockRenderer("vega")).toBe(false);
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

  // #268: the d3 block type dispatches through the same open registry —
  // the web app registers the real sandbox renderer at bootstrap; core
  // needs no central-switch edit (and ships no d3 renderer of its own).
  it("dispatches a registered d3 renderer for d3 blocks", () => {
    expect(hasBlockRenderer("d3")).toBe(false);
    registerBlockRenderer("d3", (b) => (
      <div data-testid="d3-stub">
        {String((b.content as { program: string }).program)}
      </div>
    ));
    expect(hasBlockRenderer("d3")).toBe(true);
    render(
      <ContentBlockRenderer
        block={{ type: "d3", content: { program: "api.d3;", rows: [] } }}
      />
    );
    expect(screen.getByTestId("d3-stub")).toHaveTextContent("api.d3;");
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

  // #270: the dispatch threads an optional blockRef to the renderer as
  // ctx.blockRef, so a persisted-block renderer (the d3 widget) can refresh
  // itself. Existing renderers ignore the arg.
  it("forwards blockRef to the renderer as ctx.blockRef", () => {
    let seen: unknown = "unset";
    registerBlockRenderer("blockref-test", (_b, ctx) => {
      seen = ctx?.blockRef;
      return <div data-testid="blockref-stub" />;
    });
    render(
      <ContentBlockRenderer
        block={{ type: "blockref-test", content: null }}
        blockRef={{ kind: "message", messageId: "msg-9", blockIndex: 3 }}
      />
    );
    expect(seen).toEqual({
      kind: "message",
      messageId: "msg-9",
      blockIndex: 3,
    });
  });

  it("omitting blockRef is a no-op — ctx.blockRef is undefined, render unaffected", () => {
    let seen: unknown = "unset";
    registerBlockRenderer("blockref-none-test", (_b, ctx) => {
      seen = ctx?.blockRef;
      return <div data-testid="blockref-none-stub" />;
    });
    render(
      <ContentBlockRenderer
        block={{ type: "blockref-none-test", content: null }}
      />
    );
    expect(seen).toBeUndefined();
    expect(screen.getByTestId("blockref-none-stub")).toBeInTheDocument();
  });
});
