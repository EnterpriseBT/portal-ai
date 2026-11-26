import {
  SEARCH_MAX_REFS,
  SEARCH_RESULT_TYPES,
  SearchRequestQuerySchema,
  parseSearchRefs,
} from "../../contracts/search.contract.js";

describe("SearchRequestQuerySchema (#1076)", () => {
  it("accepts no mode (favorites) and each single mode", () => {
    for (const query of [
      {},
      { q: "sales" },
      { tag: "fin" },
      { refs: "station:s1,portal:p1" },
    ]) {
      expect(SearchRequestQuerySchema.safeParse(query).success).toBe(true);
    }
  });

  it("rejects more than one mode", () => {
    expect(
      SearchRequestQuerySchema.safeParse({ q: "a", tag: "b" }).success
    ).toBe(false);
    expect(
      SearchRequestQuerySchema.safeParse({ q: "a", refs: "station:s1" }).success
    ).toBe(false);
  });

  it("rejects an unknown key", () => {
    expect(SearchRequestQuerySchema.safeParse({ search: "a" }).success).toBe(
      false
    );
  });

  it("rejects a malformed or unknown-type ref", () => {
    for (const refs of [
      "station",
      "station:",
      ":s1",
      "tag:t1",
      "station:s1,",
    ]) {
      expect(SearchRequestQuerySchema.safeParse({ refs }).success).toBe(false);
    }
  });

  it(`rejects more than ${SEARCH_MAX_REFS} refs`, () => {
    const refs = Array.from(
      { length: SEARCH_MAX_REFS + 1 },
      (_, i) => `station:s${i}`
    ).join(",");
    expect(SearchRequestQuerySchema.safeParse({ refs }).success).toBe(false);
  });

  it("trims q and tag, and refuses empty or over-long text", () => {
    const parsed = SearchRequestQuerySchema.parse({ q: "  sales  " });
    expect(parsed.q).toBe("sales");
    expect(SearchRequestQuerySchema.safeParse({ q: "   " }).success).toBe(
      false
    );
    expect(SearchRequestQuerySchema.safeParse({ tag: "" }).success).toBe(false);
    expect(
      SearchRequestQuerySchema.safeParse({ q: "x".repeat(121) }).success
    ).toBe(false);
  });

  it("parses refs into typed pairs in order", () => {
    expect(parseSearchRefs("portal:p1,station:s1")).toEqual([
      { type: "portal", id: "p1" },
      { type: "station", id: "s1" },
    ]);
  });

  it("lists the six searchable types", () => {
    expect(SEARCH_RESULT_TYPES).toEqual([
      "station",
      "pin",
      "curated_view",
      "connector_instance",
      "entity",
      "portal",
    ]);
  });
});
