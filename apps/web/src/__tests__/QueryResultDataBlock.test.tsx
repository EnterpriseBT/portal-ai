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

  it("names what will actually render in the loading label, not the total (#277)", () => {
    // The label promised the full total and then rendered a capped subset.
    const { container } = render(
      <QueryResultDataBlockUI
        rowCount={10254}
        rows={[]}
        loading={true}
        error={null}
      />
    );
    expect(container.textContent).not.toContain("Loading 10,254 rows…");
    expect(container.textContent).toMatch(/first 5,000 of 10,254/);
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
    // localized + "+" suffix → "100,000+". The surrounding wording changed in
    // #277 (the label now names the capped subset it will actually render);
    // what #147 protects is the lower-bound treatment of the total, so assert
    // that rather than the full sentence.
    expect(container.textContent).toContain("100,000+ rows…");
    expect(container.textContent).toMatch(/loading/i);
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

// ── The row-cap notice (#277) ────────────────────────────────────────
//
// The display is capped at 5,000 rows by design. The notice has to be
// accurate about three separate things, and each clause is asserted on its
// own so wording can be improved without breaking tests while the substance
// stays pinned.

describe("QueryResultDataBlockUI — row-cap notice (#277)", () => {
  beforeEach(() => {
    capturedBlocks.length = 0;
  });

  /** A capped render: 5,000 delivered out of 10,254 staged. */
  const capped = (overrides: Record<string, unknown> = {}) =>
    render(
      <QueryResultDataBlockUI
        rowCount={10254}
        rows={Array.from({ length: 5000 }, (_, i) => ({ id: i }))}
        loading={false}
        error={null}
        {...overrides}
      />
    );

  it("renders the notice with both real numbers when rows are capped", () => {
    const { container } = capped();
    const notice = container.querySelector(
      '[data-testid="query-result-row-cap-notice"]'
    );
    expect(notice).not.toBeNull();
    // Derived from rows actually received, never a hardcoded constant.
    expect(notice?.textContent).toContain("5,000");
    expect(notice?.textContent).toContain("10,254");
  });

  it("states that the full set was analysed", () => {
    // Without this, a user concludes their average/count covered only 5,000.
    const { container } = capped();
    expect(container.textContent).toMatch(/all 10,254 were analysed/i);
  });

  it("warns that sort and search cover only the shown rows (the top-N trap)", () => {
    // The load-bearing clause: sorting a truncated set to find the largest
    // value returns the largest of an arbitrary 5,000 — a confidently wrong
    // answer, not a merely incomplete one.
    const { container } = capped();
    const text = container.textContent ?? "";
    expect(text).toMatch(/sort and search/i);
    expect(text).toMatch(/only cover the 5,000 shown|won't find or rank/i);
  });

  it("tells the user to ask for ranking or filtering in the query", () => {
    const { container } = capped();
    expect(container.textContent).toMatch(/ask for it in the query/i);
  });

  it("renders no notice when every row was delivered", () => {
    const { container } = render(
      <QueryResultDataBlockUI
        rowCount={3}
        rows={[{ id: 1 }, { id: 2 }, { id: 3 }]}
        loading={false}
        error={null}
      />
    );
    expect(
      container.querySelector('[data-testid="query-result-row-cap-notice"]')
    ).toBeNull();
  });

  it("renders the total as a lower bound (N+) when staging was truncated", () => {
    const { container } = capped({ rowCount: 100000, truncated: true });
    const notice = container.querySelector(
      '[data-testid="query-result-row-cap-notice"]'
    );
    expect(notice?.textContent).toContain("100,000+");
  });

  it("renders no notice and does not crash on an empty result", () => {
    const { container } = render(
      <QueryResultDataBlockUI
        rowCount={0}
        rows={[]}
        loading={false}
        error={null}
      />
    );
    expect(
      container.querySelector('[data-testid="query-result-row-cap-notice"]')
    ).toBeNull();
  });

  it("shows the error state instead of the notice when the fetch failed", () => {
    const { container } = capped({ error: "expired" });
    expect(
      container.querySelector('[data-testid="query-result-row-cap-notice"]')
    ).toBeNull();
  });
});

describe("QueryResultDataBlockUI — matchedCount (#340)", () => {
  beforeEach(() => {
    capturedBlocks.length = 0;
  });

  // Staged 100k, but the query matched 413,311 — display the TRUE total.
  const bigMatch = (overrides: Record<string, unknown> = {}) =>
    render(
      <QueryResultDataBlockUI
        rowCount={100000}
        truncated={true}
        matchedCount={413311}
        matchedCountExact={true}
        rows={Array.from({ length: 5000 }, (_, i) => ({ id: i }))}
        loading={false}
        error={null}
        {...overrides}
      />
    );

  it("shows the true matched total, not the staged rowCount", () => {
    const { container } = bigMatch();
    const text = container.textContent ?? "";
    expect(text).toContain("413,311");
    expect(text).toContain("of 413,311"); // "…first 5,000 of 413,311 rows"
  });

  it("says analysis ran on the first HANDLE_ROW_CAP, not 'all were analysed'", () => {
    const { container } = bigMatch();
    const text = container.textContent ?? "";
    expect(text).toMatch(/first 100,000/i); // analysis cap, honest
    expect(text).not.toMatch(/all 413,311 were analysed/i);
  });

  it("renders matchedCount as a lower bound (N+) when not exact", () => {
    const { container } = bigMatch({ matchedCountExact: false });
    expect(container.textContent ?? "").toContain("413,311+");
  });

  it("falls back to rowCount when matchedCount is absent (pre-#340 block)", () => {
    const { container } = render(
      <QueryResultDataBlockUI
        rowCount={10254}
        rows={Array.from({ length: 5000 }, (_, i) => ({ id: i }))}
        loading={false}
        error={null}
      />
    );
    expect(container.textContent ?? "").toContain("10,254");
  });
});
