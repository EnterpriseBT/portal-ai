import { describe, it, expect } from "@jest/globals";

import { parseProjections } from "../../utils/sql-projection.util.js";

describe("parseProjections", () => {
  it("parses a single simple projection", () => {
    expect(parseProjections('"c_a" AS c_x')).toEqual([
      { value: '"c_a"', alias: "c_x" },
    ]);
  });

  it("parses an arithmetic projection with parens", () => {
    expect(
      parseProjections(
        '("c_diameter_km_min" + "c_diameter_km_max") / 2.0 AS c_diameter_avg_km'
      )
    ).toEqual([
      {
        value:
          '("c_diameter_km_min" + "c_diameter_km_max") / 2.0',
        alias: "c_diameter_avg_km",
      },
    ]);
  });

  it("does not split on commas inside parens", () => {
    expect(
      parseProjections('GREATEST("c_a", "c_b") AS c_max')
    ).toEqual([
      { value: 'GREATEST("c_a", "c_b")', alias: "c_max" },
    ]);
  });

  it("splits multiple top-level projections", () => {
    expect(
      parseProjections(
        'UPPER("c_name") AS c_upper, LENGTH("c_name") AS c_len'
      )
    ).toEqual([
      { value: 'UPPER("c_name")', alias: "c_upper" },
      { value: 'LENGTH("c_name")', alias: "c_len" },
    ]);
  });

  it("strips quotes from quoted aliases", () => {
    expect(parseProjections('1 AS "c_one"')).toEqual([
      { value: "1", alias: "c_one" },
    ]);
  });

  it("respects string literals when scanning for AS", () => {
    expect(
      parseProjections("'a AS b' || \"c_name\" AS c_label")
    ).toEqual([
      { value: "'a AS b' || \"c_name\"", alias: "c_label" },
    ]);
  });

  it("is case-insensitive for AS", () => {
    expect(parseProjections('"c_a" as c_x')).toEqual([
      { value: '"c_a"', alias: "c_x" },
    ]);
  });

  it("throws with actionable guidance when a segment has no AS alias", () => {
    expect(() => parseProjections('"c_a"')).toThrow(/missing an AS alias/);
    expect(() => parseProjections('"c_a"')).toThrow(/keyField/);
  });

  it("throws when alias is empty", () => {
    expect(() => parseProjections('"c_a" AS ')).toThrow(/empty alias/);
  });
});
