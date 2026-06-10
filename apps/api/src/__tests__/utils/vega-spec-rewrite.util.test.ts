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

  it("passes through specs with no data field at all", () => {
    const spec = { mark: "bar", encoding: {} };
    expect(rewriteForNamedDataset(spec)).toEqual(spec);
  });
});
