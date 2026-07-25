import { jest } from "@jest/globals";
import type { PortalMessageBlock } from "@portalai/core/contracts";

// ── Mocks ────────────────────────────────────────────────────────────

// Capture what block ContentBlockRenderer was handed; the test asserts
// against this rather than the rendered output (the block shape is the
// load-bearing contract).
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

  it("renders loading state while the snapshot fetch is in flight", () => {
    const { container } = render(
      <QueryResultDataBlockUI
        rowCount={500}
        rows={[]}
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
        loading={false}
        error="The data has expired from cache."
      />
    );
    expect(
      container.querySelector('[data-testid="query-result-data-block-error"]')
    ).not.toBeNull();
    expect(capturedBlocks).toHaveLength(0);
  });

  it("routes fetched rows to a data-table block (tabular envelope)", () => {
    const rows = [{ id: "p-1", name: "Alice" }];
    render(
      <QueryResultDataBlockUI
        rowCount={1}
        rows={rows}
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
