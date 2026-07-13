import { describe, it, expect } from "@jest/globals";
import { readFileSync } from "node:fs";

/**
 * Invariant guard (#114): the built-in compute tools must stay PURE — they
 * receive data as input (via compute-input.util) and never read the backend.
 * This fails if any of them re-acquires a read coupling (fetchEntityRows, the
 * wide-table repo, or stationData).
 *
 * Reduced to 8 tools in #130 E2: describe_column / correlate / detect_outliers
 * / aggregate / trend / changepoint / decompose / sharpe_ratio / max_drawdown
 * / rolling_returns were removed (expressed directly in sql_query).
 */

const COMPUTE_TOOL_FILES = [
  // statistics
  "cluster",
  "hypothesis-test",
  // regression
  "regression",
  "logistic-regression",
  "forecast",
  // financial (data-dependent)
  "technical-indicator",
  "var-cvar",
  "portfolio-metrics",
];

// Symbols that would mean the tool reads the backend again.
const FORBIDDEN_SYMBOLS = [
  "fetchEntityRows",
  "wideTableRepo",
  "fetchProjectedRows",
  "tools.util",
  "StationData",
];

describe("compute-tool purity guard (#114)", () => {
  it("covers all 8 refactored compute tools", () => {
    expect(COMPUTE_TOOL_FILES).toHaveLength(8);
  });

  for (const name of COMPUTE_TOOL_FILES) {
    const source = readFileSync(
      new URL(`../../tools/${name}.tool.ts`, import.meta.url),
      "utf8"
    );

    describe(`${name}.tool.ts`, () => {
      it("does not read the backend (no fetchEntityRows / wide-table / stationData)", () => {
        for (const symbol of FORBIDDEN_SYMBOLS) {
          expect({
            tool: name,
            symbol,
            present: source.includes(symbol),
          }).toEqual({ tool: name, symbol, present: false });
        }
      });

      it("uses the shared pure-compute contract (compute-input.util)", () => {
        expect(source).toContain("compute-input.util");
      });
    });
  }
});
