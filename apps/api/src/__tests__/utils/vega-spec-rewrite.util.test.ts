import { describe, it, expect } from "@jest/globals";
import { rewriteForNamedDataset } from "../../utils/vega-spec-rewrite.util.js";

describe("rewriteForNamedDataset", () => {
  it("rewrites data: { values: [...] } to data: { name: 'primary' }", () => {
    const spec = {
      mark: "bar",
      data: { values: [{ x: 1 }, { x: 2 }] },
      encoding: { x: { field: "x", type: "quantitative" } },
    };
    const out = rewriteForNamedDataset(spec);
    expect(out.data).toEqual({ name: "primary" });
  });

  it("rewrites data: { values: [] } (empty inline) to named dataset", () => {
    const spec = { mark: "point", data: { values: [] } };
    const out = rewriteForNamedDataset(spec);
    expect(out.data).toEqual({ name: "primary" });
  });

  it("accepts a custom dataset name", () => {
    const spec = { mark: "bar", data: { values: [] } };
    const out = rewriteForNamedDataset(spec, "main");
    expect(out.data).toEqual({ name: "main" });
  });

  it("passes through specs already using a named dataset", () => {
    const spec = { mark: "bar", data: { name: "primary" } };
    expect(rewriteForNamedDataset(spec)).toEqual(spec);
  });

  it("passes through multi-source specs (datasets: {...})", () => {
    const spec = {
      datasets: { left: [{ x: 1 }], right: [{ y: 2 }] },
      layer: [],
    };
    expect(rewriteForNamedDataset(spec)).toEqual(spec);
  });

  // #109: agents commonly emit specs without a `data` field at all
  // and expect the runtime to provide it. Pre-fix the rewrite passed
  // through unchanged; the handle path then had nowhere for the
  // snapshot rows to bind (chart rendered axes but no marks). Post-
  // fix the rewrite injects `data: { name: "primary" }` so the rows
  // land via react-vega's `data` prop.
  it("injects data: { name: 'primary' } when the spec has no data field", () => {
    const spec = { mark: "bar", encoding: { x: { field: "c_date" } } };
    const out = rewriteForNamedDataset(spec);
    expect(out.data).toEqual({ name: "primary" });
    expect(out.mark).toBe("bar");
    expect(out.encoding).toEqual(spec.encoding);
  });

  it("passes through specs with a URL-loaded data source", () => {
    const spec = {
      mark: "bar",
      data: { url: "https://example.com/data.json" },
    };
    expect(rewriteForNamedDataset(spec)).toEqual(spec);
  });
});
