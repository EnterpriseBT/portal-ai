import {
  BUILTIN_TOOLPACKS,
  BUILTIN_TOOLPACK_BY_SLUG,
  BuiltinToolpackSlugSchema,
  isBuiltinToolpackSlug,
} from "../../registries/builtin-toolpacks.js";
import {
  ToolCapabilitySchema,
  deriveToolRole,
} from "../../models/tool-capability.model.js";

describe("BUILTIN_TOOLPACKS", () => {
  // Case 1
  it("registers exactly seven packs", () => {
    expect(BUILTIN_TOOLPACKS.length).toBe(7);
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
      "visualize",
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

  // Case 11 — #121 child A: every tool carries a coherent capability.
  it("every tool declares a capability that passes the coherence schema", () => {
    for (const pack of BUILTIN_TOOLPACKS) {
      for (const tool of pack.tools) {
        const parsed = ToolCapabilitySchema.safeParse(tool.capability);
        expect(parsed.success).toBe(true);
      }
    }
  });

  // Case 12 — privilege sanity per pack.
  it("entity_management tools write + lock; pure-math financial tools are pure", () => {
    const em = BUILTIN_TOOLPACK_BY_SLUG.entity_management;
    for (const tool of em.tools) {
      expect(tool.capability.writes.length).toBeGreaterThan(0);
      expect(tool.capability.locks.length).toBeGreaterThan(0);
    }
    const fin = BUILTIN_TOOLPACK_BY_SLUG.financial;
    const pureMathNames = [
      "npv",
      "irr",
      "tvm",
      "xnpv",
      "xirr",
      "depreciation",
      "amortize",
      "bond_math",
    ];
    for (const tool of fin.tools) {
      if (pureMathNames.includes(tool.name)) {
        expect(tool.capability.pure).toBe(true);
        expect(tool.capability.consumption.mode).toBe("none");
      }
    }
  });

  // Case 13 — derived role lines up with privilege.
  it("readers derive as producers, writers as transformers, pure-math as none", () => {
    const byName = new Map<string, ReturnType<typeof deriveToolRole>>();
    for (const pack of BUILTIN_TOOLPACKS) {
      for (const tool of pack.tools) {
        byName.set(tool.name, deriveToolRole(tool.capability));
      }
    }
    expect(byName.get("sql_query")).toBe("producer");
    expect(byName.get("entity_record_create")).toBe("transformer");
    expect(byName.get("hypothesis_test")).toBe("consumer");
    expect(byName.get("npv")).toBe("none");
  });
});

// #269 — the visualize pack + visualize_d3 tool contract.
describe("visualize pack (#269)", () => {
  const pack = BUILTIN_TOOLPACKS.find((p) => p.slug === "visualize");
  const tool = pack?.tools.find((t) => t.name === "visualize_d3");

  it("exists with exactly the visualize_d3 tool", () => {
    expect(pack).toBeDefined();
    expect(pack!.tools).toHaveLength(1);
    expect(pack!.tools[0].name).toBe("visualize_d3");
  });

  it("visualize_d3 takes intent (sql + instruction + optional title), not a program", () => {
    const schema = tool!.parameterSchema;
    const props = schema.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(["instruction", "sql", "title"]);
    expect(schema.required).toEqual(["sql", "instruction"]);
    // The agent supplies intent — never a program or a Vega spec.
    expect(props.d3Program).toBeUndefined();
    expect(props.spec).toBeUndefined();
  });

  it("visualize_d3 capability: d3 result, expensive (Opus codegen), handle-on-large", () => {
    const cap = tool!.capability;
    expect(cap.resultKind).toBe("d3");
    expect(cap.costHint).toBe("expensive");
    expect(cap.production).toEqual({ kind: "rows", onLarge: "handle" });
    expect(ToolCapabilitySchema.safeParse(cap).success).toBe(true);
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
    expect(isBuiltinToolpackSlug("visualize")).toBe(true);
  });

  it("returns false for unknown values", () => {
    expect(isBuiltinToolpackSlug("")).toBe(false);
    expect(isBuiltinToolpackSlug("foo")).toBe(false);
    expect(isBuiltinToolpackSlug("DATA_QUERY")).toBe(false);
    expect(isBuiltinToolpackSlug("data-query")).toBe(false);
  });
});

describe("BuiltinToolpackSlugSchema", () => {
  it("accepts all registered slugs", () => {
    expect(BuiltinToolpackSlugSchema.safeParse("data_query").success).toBe(
      true
    );
    expect(
      BuiltinToolpackSlugSchema.safeParse("entity_management").success
    ).toBe(true);
    expect(BuiltinToolpackSlugSchema.safeParse("visualize").success).toBe(true);
  });

  it("rejects unknown slugs", () => {
    expect(BuiltinToolpackSlugSchema.safeParse("future_pack").success).toBe(
      false
    );
  });
});
