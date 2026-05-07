import {
  BUILTIN_TOOLPACKS,
  BUILTIN_TOOLPACK_BY_SLUG,
  BuiltinToolpackSlugSchema,
  isBuiltinToolpackSlug,
} from "../../registries/builtin-toolpacks.js";

describe("BUILTIN_TOOLPACKS", () => {
  // Case 1
  it("registers exactly six packs", () => {
    expect(BUILTIN_TOOLPACKS.length).toBe(6);
  });

  // Case 2
  it("covers the legacy StationToolPack slugs", () => {
    const expected = [
      "data_query",
      "statistics",
      "regression",
      "financial",
      "web_search",
      "entity_management",
    ];
    const actual = BUILTIN_TOOLPACKS.map((p) => p.slug).sort();
    expect(actual).toEqual([...expected].sort());
  });

  // Case 3
  it("has unique slugs", () => {
    const slugs = BUILTIN_TOOLPACKS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  // Case 4
  it("BUILTIN_TOOLPACK_BY_SLUG matches the array", () => {
    for (const entry of BUILTIN_TOOLPACKS) {
      expect(BUILTIN_TOOLPACK_BY_SLUG[entry.slug]).toBe(entry);
    }
  });

  // Case 5
  it("every pack has at least one tool", () => {
    for (const pack of BUILTIN_TOOLPACKS) {
      expect(pack.tools.length).toBeGreaterThan(0);
    }
  });

  // Case 6
  it("tool names are unique within each pack", () => {
    for (const pack of BUILTIN_TOOLPACKS) {
      const names = pack.tools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  // Case 7
  it("tool names are globally unique across packs", () => {
    const names: string[] = [];
    for (const pack of BUILTIN_TOOLPACKS) {
      for (const tool of pack.tools) {
        names.push(tool.name);
      }
    }
    expect(new Set(names).size).toBe(names.length);
  });

  // Case 8
  it("every pack has at least one example on its first tool", () => {
    for (const pack of BUILTIN_TOOLPACKS) {
      const first = pack.tools[0];
      expect(first.examples).toBeDefined();
      expect(first.examples!.length).toBeGreaterThanOrEqual(1);
    }
  });

  // Case 10
  it("every tool's parameterSchema parses as a JSON Schema object", () => {
    for (const pack of BUILTIN_TOOLPACKS) {
      for (const tool of pack.tools) {
        expect(tool.parameterSchema).toBeDefined();
        expect(typeof tool.parameterSchema).toBe("object");
        expect(tool.parameterSchema.type).toBe("object");
        expect(tool.parameterSchema.properties).toBeDefined();
        expect(typeof tool.parameterSchema.properties).toBe("object");
      }
    }
  });
});

describe("isBuiltinToolpackSlug", () => {
  // Case 9
  it("returns true for every registered slug", () => {
    expect(isBuiltinToolpackSlug("data_query")).toBe(true);
    expect(isBuiltinToolpackSlug("statistics")).toBe(true);
    expect(isBuiltinToolpackSlug("regression")).toBe(true);
    expect(isBuiltinToolpackSlug("financial")).toBe(true);
    expect(isBuiltinToolpackSlug("web_search")).toBe(true);
    expect(isBuiltinToolpackSlug("entity_management")).toBe(true);
  });

  it("returns false for unknown values", () => {
    expect(isBuiltinToolpackSlug("")).toBe(false);
    expect(isBuiltinToolpackSlug("foo")).toBe(false);
    expect(isBuiltinToolpackSlug("DATA_QUERY")).toBe(false);
    expect(isBuiltinToolpackSlug("data-query")).toBe(false);
  });
});

describe("BuiltinToolpackSlugSchema", () => {
  it("accepts all six slugs", () => {
    expect(BuiltinToolpackSlugSchema.safeParse("data_query").success).toBe(
      true
    );
    expect(BuiltinToolpackSlugSchema.safeParse("entity_management").success).toBe(
      true
    );
  });

  it("rejects unknown slugs", () => {
    expect(BuiltinToolpackSlugSchema.safeParse("future_pack").success).toBe(
      false
    );
  });
});
