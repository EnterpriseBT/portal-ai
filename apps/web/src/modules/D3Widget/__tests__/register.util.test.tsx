import type { ReactElement } from "react";

import { jest } from "@jest/globals";
import {
  render as rtlRender,
  screen,
  type RenderOptions,
} from "@testing-library/react";

import { ThemeProvider } from "@portalai/core/ui";

// D3Widget reaches the SDK through the progressive hook; the registry
// test only exercises the inline path, so a call-asserting stub suffices.
const mutateAsync = jest.fn();
const refreshMutate = jest.fn();
jest.unstable_mockModule("../../../api/sdk", () => ({
  sdk: {
    portalSql: {
      // #796: the "Show data" table's paged read.
      handleSnapshot: () => ({
        data: undefined,
        error: null,
        isFetching: false,
      }),
      handleSnapshotPage: () => ({ mutateAsync }),
      widgetRefresh: () => ({ mutateAsync: refreshMutate, isPending: false }),
    },
    portalResults: {
      // #640: a pin's live data query (inert here — no pin refs).
      data: () => ({
        data: undefined,
        error: null,
        isFetching: false,
        dataUpdatedAt: 0,
        refetch: jest.fn(),
      }),
    },
  },
}));

const { ContentBlockRenderer, hasBlockRenderer } =
  await import("@portalai/core");
const { registerD3BlockRenderer } = await import("../utils/register.util");

// The app always renders inside the brand ThemeProvider, whose palette
// carries `dataViz` (#1022); MUI's default theme doesn't.
const render = (ui: ReactElement, options?: RenderOptions) =>
  rtlRender(ui, {
    wrapper: ({ children }) => (
      <ThemeProvider defaultTheme="brand">{children}</ThemeProvider>
    ),
    ...options,
  });

describe("registerD3BlockRenderer (spec case 25)", () => {
  it("registers the d3 renderer into the open registry, idempotently", () => {
    expect(hasBlockRenderer("d3")).toBe(false);

    registerD3BlockRenderer();
    expect(hasBlockRenderer("d3")).toBe(true);

    // Second call is harmless (bootstrap + tests may both call it).
    registerD3BlockRenderer();
    expect(hasBlockRenderer("d3")).toBe(true);
  });

  it("dispatches a d3 block through ContentBlockRenderer to the D3Widget", () => {
    registerD3BlockRenderer();
    render(
      <ContentBlockRenderer
        block={{
          type: "d3",
          content: {
            program: "api.d3.select(api.container);",
            rows: [{ x: 1 }],
          },
        }}
      />
    );
    expect(screen.getByTestId("d3-widget")).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });
});
