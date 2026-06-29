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
});
