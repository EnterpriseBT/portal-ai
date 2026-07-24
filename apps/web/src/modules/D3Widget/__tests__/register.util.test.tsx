import { jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

// D3Widget reaches the SDK through the progressive hook; the registry
// test only exercises the inline path, so a call-asserting stub suffices.
const mutateAsync = jest.fn();
jest.unstable_mockModule("../../../api/sdk", () => ({
  sdk: {
    portalSql: {
      handleSnapshotPage: () => ({ mutateAsync }),
    },
  },
}));

const { ContentBlockRenderer, hasBlockRenderer } =
  await import("@portalai/core");
const { registerD3BlockRenderer } = await import("../utils/register.util");

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
