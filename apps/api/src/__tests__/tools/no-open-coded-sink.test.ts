import { describe, it, expect } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard (#164): the inline-vs-handle decision for SQL-backed outputs lives in
 * one place — `result-sink.ts` (`resolveResultSink` / `resolveSqlDelivery`).
 * No tool may open-code the old pattern of pairing an `INLINE_ROWS_THRESHOLD`
 * check with a `PortalSqlHandleService.produce(...)` staging call. (Tools that
 * always stage a handle — e.g. `display_entity_records` — are fine: they have
 * no threshold check. `technical_indicator` uses the transform-handle
 * mechanism, not the SQL `produce()` path.)
 */
describe("output-sink consolidation guard", () => {
  const toolsDir = join(process.cwd(), "src", "tools");
  const toolFiles = readdirSync(toolsDir).filter((f) => f.endsWith(".tool.ts"));

  it("finds tool files to scan", () => {
    expect(toolFiles.length).toBeGreaterThan(0);
  });

  it.each(toolFiles)(
    "%s does not open-code an INLINE_ROWS_THRESHOLD + produce() sink",
    (file) => {
      const src = readFileSync(join(toolsDir, file), "utf8");
      const hasThreshold = src.includes("INLINE_ROWS_THRESHOLD");
      const stagesSqlHandle = /PortalSqlHandleService\.produce\(/.test(src);
      // The forbidden combination is the hand-coded SQL inline-vs-handle check.
      expect(hasThreshold && stagesSqlHandle).toBe(false);
    }
  );

  /**
   * Guard (#349): a tool that calls `resolveSqlDelivery` **directly** — rather
   * than going through `resolveResultSink`, which attaches one for free — is
   * hand-wrapping a SQL delivery and must attach the durable `pipeline`
   * itself, on every branch. Missing it mints a terminal snapshot, the exact
   * defect #349 removes.
   *
   * Deliberately keyed on `resolveSqlDelivery` rather than on the presence of
   * a `data-table` literal: tools with no originating SELECT to re-run
   * (`display_entity_records` stages supplied rows; `technical_indicator`
   * folds a transform handle) legitimately have no pipeline, and a blanket
   * rule would flag them.
   */
  it.each(toolFiles)(
    "%s attaches a pipeline when it wraps resolveSqlDelivery itself",
    (file) => {
      const src = readFileSync(join(toolsDir, file), "utf8");
      if (!src.includes("resolveSqlDelivery")) return;
      // Every `return { type: "…", … }` in the file must carry `pipeline` as a
      // property (shorthand or keyed) — matching the bare word would also
      // accept a passing mention in a comment.
      const returns = src.matchAll(/return\s*\{[\s\S]*?\n\s*\};?/g);
      const minted = [...returns].filter((m) => /\btype:\s*"/.test(m[0]));
      expect(minted.length).toBeGreaterThan(0);
      for (const [fragment] of minted) {
        expect(fragment).toMatch(/\bpipeline[,:]/);
      }
    }
  );
});
