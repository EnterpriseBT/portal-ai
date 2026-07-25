import { streamingBlockFor } from "../utils/portal-stream.util";

// The pure tool_result → display-block mapping used by usePortalStream's SSE
// handler. Keyed on the result's `type` so the visualize_d3 codegen fallback
// (which shares the toolName but tags `type:"data-table"`) routes correctly.

const PROGRAM = "api.d3.select(api.container);";

describe("streamingBlockFor (#269)", () => {
  it("maps a type:d3 result to a d3 block", () => {
    const block = streamingBlockFor("visualize_d3", {
      type: "d3",
      program: PROGRAM,
      rows: [{ x: 1 }],
    });
    expect(block).toEqual({
      type: "d3",
      content: { type: "d3", program: PROGRAM, rows: [{ x: 1 }] },
    });
  });

  it("maps a type:d3 result to a d3 block regardless of toolName", () => {
    const block = streamingBlockFor("something_else", {
      type: "d3",
      program: PROGRAM,
    });
    expect(block?.type).toBe("d3");
  });

  it("routes the visualize_d3 data-table fallback (type:data-table) to data-table, not d3", () => {
    const block = streamingBlockFor("visualize_d3", {
      type: "data-table",
      rows: [{ x: 1 }],
      message: "codegen failed",
    });
    expect(block?.type).toBe("data-table");
  });

  // #272: the Vega tools are gone — a `vega-lite`/`vega`-typed result no
  // longer maps to any display block (routing is keyed on `type`, and
  // those types are unknown to the mapper now).
  it("maps a vega-lite / vega result to no block (Vega removed)", () => {
    expect(
      streamingBlockFor("visualize", { type: "vega-lite", spec: {} })
    ).toBeNull();
    expect(
      streamingBlockFor("visualize_tree", { type: "vega", spec: {} })
    ).toBeNull();
  });

  it("returns null for a result with no recognizable display shape", () => {
    expect(streamingBlockFor("sql_query", null)).toBeNull();
    expect(streamingBlockFor("resolve_identity", { matches: [] })).toBeNull();
  });
});
