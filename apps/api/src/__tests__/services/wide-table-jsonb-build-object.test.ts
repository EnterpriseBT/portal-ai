import { describe, it, expect } from "@jest/globals";

import { buildJsonbObjectExpr } from "../../services/wide-table-statement.cache.js";

/**
 * Regression — `jsonb_build_object` has a postgres-side 100-argument cap
 * (2 args per key/value pair). Without chunking, any wide-table entity
 * with more than 50 columns trips `42883: cannot pass more than 100
 * arguments to a function` on every hydrated read. The helper chunks at
 * 49 pairs and joins with `||` (jsonb concat is key-wise merge).
 */
describe("buildJsonbObjectExpr", () => {
  it("returns '{}'::jsonb for an empty pair list", () => {
    expect(buildJsonbObjectExpr([])).toBe(`'{}'::jsonb`);
  });

  it("inlines into a single jsonb_build_object call when at-or-under the chunk size", () => {
    const pairs = Array.from(
      { length: 49 },
      (_, i) => `'k${i}', "w"."c${i}"`
    );
    const expr = buildJsonbObjectExpr(pairs);
    expect(expr.startsWith("jsonb_build_object(")).toBe(true);
    expect(expr.includes("||")).toBe(false);
    // All 49 pairs are present.
    expect((expr.match(/'k\d+', "w"\."c\d+"/g) ?? []).length).toBe(49);
  });

  it("splits into multiple jsonb_build_object calls joined by `||` when above the chunk size", () => {
    // 59 pairs — the column count that surfaced the bug in slice 6's
    // smoke test (a 59-column CSV upload). 59 × 2 = 118 args, over the
    // 100-arg postgres function cap.
    const pairs = Array.from(
      { length: 59 },
      (_, i) => `'k${i}', "w"."c${i}"`
    );
    const expr = buildJsonbObjectExpr(pairs);

    // Two chunks: 49 + 10.
    const chunks = expr.split(" || ");
    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(chunk.startsWith("jsonb_build_object(")).toBe(true);
      expect(chunk.endsWith(")")).toBe(true);
    }

    // Argument count stays under 100 per chunk.
    for (const chunk of chunks) {
      const argCount = (chunk.match(/'k\d+'|"w"\."c\d+"/g) ?? []).length;
      expect(argCount).toBeLessThanOrEqual(98);
    }

    // All 59 pairs survive across the chunks.
    expect((expr.match(/'k\d+', "w"\."c\d+"/g) ?? []).length).toBe(59);
  });

  it("chunks at the documented 49-pair boundary even for very wide tables (200 columns)", () => {
    const pairs = Array.from(
      { length: 200 },
      (_, i) => `'k${i}', "w"."c${i}"`
    );
    const expr = buildJsonbObjectExpr(pairs);

    // 200 / 49 = 4 full chunks of 49, remainder 4 → 5 chunks total.
    const chunks = expr.split(" || ");
    expect(chunks).toHaveLength(5);
    expect((expr.match(/'k\d+', "w"\."c\d+"/g) ?? []).length).toBe(200);
  });
});
