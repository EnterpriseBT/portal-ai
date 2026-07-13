import { jest } from "@jest/globals";
import type { PortalMessageBlock } from "@portalai/core/contracts";

// ── Mocks ────────────────────────────────────────────────────────────

// Capture what block ContentBlockRenderer was handed; the test asserts
// against this rather than the rendered output (react-vega is heavy +
// async; the block shape is the load-bearing contract).
const capturedBlocks: PortalMessageBlock[] = [];

jest.unstable_mockModule("@portalai/core", () => ({
  ContentBlockRenderer: ({ block }: { block: PortalMessageBlock }) => {
    capturedBlocks.push(block);
    return null;
  },
}));

// ── Imports ──────────────────────────────────────────────────────────

const { render } = await import("./test-utils");
const { QueryResultDataBlockUI } =
  await import("../components/QueryResultDataBlock.component");

// ── Tests ────────────────────────────────────────────────────────────

describe("QueryResultDataBlockUI", () => {
  beforeEach(() => {
    capturedBlocks.length = 0;
  });

  // Regression for #109: pre-fix, QRDB injected rows into
  // `spec.datasets.primary` — a shape react-vega's VegaLite component
  // doesn't reliably resolve (axes drew, marks did not). Post-fix the
  // block carries `{ spec, datasets }` and ContentBlockRenderer
  // forwards `datasets` to react-vega's `data` prop. This keeps the
  // streaming-ready named-dataset binding intact (for future
  // `vega.changeset` SSE increments) while making the snapshot path
  // actually render.
  it("forwards fetched rows via the block's `datasets` wrapper for the chart path", () => {
    const spec = {
      mark: "bar",
      encoding: {
        x: { field: "category", type: "nominal" },
        y: { field: "value", type: "quantitative" },
      },
      // Produced by the visualize tool's `rewriteForNamedDataset`.
      data: { name: "primary" },
    };
    const rows = [
      { category: "a", value: 1 },
      { category: "b", value: 2 },
    ];

    render(
      <QueryResultDataBlockUI
        rowCount={2}
        rows={rows}
        spec={spec}
        loading={false}
        error={null}
      />
    );

    expect(capturedBlocks).toHaveLength(1);
    const block = capturedBlocks[0];
    expect(block.type).toBe("vega-lite");
    const content = block.content as Record<string, unknown>;
    // Wrapper shape: spec is left untouched (named-dataset reference
    // preserved); rows arrive in a sibling `datasets` map keyed by
    // dataset name.
    expect(content.spec).toEqual(spec);
    expect(content.datasets).toEqual({ primary: rows });
  });

  it("renders loading state while the snapshot fetch is in flight", () => {
    const { container } = render(
      <QueryResultDataBlockUI
        rowCount={500}
        rows={[]}
        spec={{ mark: "bar" }}
        loading={true}
        error={null}
      />
    );
    expect(
      container.querySelector('[data-testid="query-result-data-block-loading"]')
    ).not.toBeNull();
    expect(capturedBlocks).toHaveLength(0);
  });

  it("renders the loading count as an exact number when not truncated", () => {
    const { container } = render(
      <QueryResultDataBlockUI
        rowCount={500}
        rows={[]}
        spec={{ mark: "bar" }}
        loading={true}
        error={null}
      />
    );
    expect(container.textContent).toContain("Loading 500 rows…");
  });

  it("renders the loading count as a lower bound (N+) when truncated (#147)", () => {
    const { container } = render(
      <QueryResultDataBlockUI
        rowCount={100000}
        truncated={true}
        rows={[]}
        spec={{ mark: "bar" }}
        loading={true}
        error={null}
      />
    );
    // localized + "+" suffix → "100,000+"
    expect(container.textContent).toContain("Loading 100,000+ rows…");
  });

  it("renders error state when the snapshot fetch fails", () => {
    const { container } = render(
      <QueryResultDataBlockUI
        rowCount={500}
        rows={[]}
        spec={{ mark: "bar" }}
        loading={false}
        error="The chart's data has expired from cache."
      />
    );
    expect(
      container.querySelector('[data-testid="query-result-data-block-error"]')
    ).not.toBeNull();
    expect(capturedBlocks).toHaveLength(0);
  });

  it("routes to data-table block when spec is absent (tabular envelope)", () => {
    const rows = [{ id: "p-1", name: "Alice" }];
    render(
      <QueryResultDataBlockUI
        rowCount={1}
        rows={rows}
        spec={undefined}
        loading={false}
        error={null}
      />
    );
    expect(capturedBlocks).toHaveLength(1);
    expect(capturedBlocks[0].type).toBe("data-table");
    const content = capturedBlocks[0].content as {
      columns: string[];
      rows: Record<string, unknown>[];
    };
    expect(content.columns).toEqual(["id", "name"]);
    expect(content.rows).toEqual(rows);
  });
});
