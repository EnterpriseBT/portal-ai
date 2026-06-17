import {
  ToolCapabilitySchema,
  deriveToolRole,
  type ToolCapability,
} from "../../models/tool-capability.model.js";

// ── Fixtures ─────────────────────────────────────────────────────────
//
// One per archetype in the taxonomy census (docs/TOOLPACK_TAXONOMY.spec.md).

const pureMath: ToolCapability = {
  pure: true,
  reads: [],
  writes: [],
  consumption: { mode: "none" },
  computeShape: "pure",
  costHint: "free",
  locks: [],
  resultKind: "scalar",
  alwaysAvailable: false,
};

const reader: ToolCapability = {
  // sql_query / display_entity_records — producer
  pure: false,
  reads: ["entity_records"],
  writes: [],
  consumption: { mode: "engine-pushdown" },
  computeShape: "scan",
  costHint: "free",
  locks: [],
  resultKind: "data-table",
  alwaysAvailable: false,
};

const streamingReduce: ToolCapability = {
  // forecast / technical_indicator — pure consumer over handed-in records
  pure: true,
  reads: [],
  writes: [],
  consumption: { mode: "streaming" },
  computeShape: "reduce",
  costHint: "metered",
  locks: [],
  resultKind: "data-table",
  alwaysAvailable: false,
};

const boundedReduce: ToolCapability = {
  // cluster / logistic_regression — needs the whole set
  pure: true,
  reads: [],
  writes: [],
  consumption: { mode: "bounded", maxRows: 100_000, onOverflow: "sample" },
  computeShape: "reduce",
  costHint: "expensive",
  locks: [],
  resultKind: "data-table",
  alwaysAvailable: false,
};

const pushdownReduce: ToolCapability = {
  // hypothesis_test / var_cvar / regression — pushdown is a read, so NOT pure
  pure: false,
  reads: ["entity_records"],
  writes: [],
  consumption: { mode: "engine-pushdown" },
  computeShape: "reduce",
  costHint: "free",
  locks: [],
  resultKind: "scalar",
  alwaysAvailable: false,
};

const writer: ToolCapability = {
  // entity_record_update — transformer
  pure: false,
  reads: ["entity_records"],
  writes: ["entity_records"],
  consumption: { mode: "bounded", maxRows: 100, onOverflow: "error" },
  computeShape: "mutate",
  costHint: "free",
  locks: ["recordIds"],
  resultKind: "mutation-result",
  alwaysAvailable: false,
};

// ── Valid shapes ─────────────────────────────────────────────────────

describe("ToolCapabilitySchema — valid archetypes", () => {
  it.each([
    ["pure-math", pureMath],
    ["reader/producer", reader],
    ["streaming reduce", streamingReduce],
    ["bounded reduce", boundedReduce],
    ["pushdown reduce", pushdownReduce],
    ["writer/transformer", writer],
  ])("accepts a %s capability", (_label, cap) => {
    expect(ToolCapabilitySchema.safeParse(cap).success).toBe(true);
  });
});

// ── Consumption refinement ───────────────────────────────────────────

describe("ToolCapabilitySchema — consumption contract", () => {
  it("rejects bounded without maxRows + onOverflow", () => {
    const bad = { ...boundedReduce, consumption: { mode: "bounded" as const } };
    expect(ToolCapabilitySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects maxRows/onOverflow on a non-bounded mode", () => {
    const bad = {
      ...streamingReduce,
      consumption: { mode: "streaming" as const, maxRows: 100, onOverflow: "sample" as const },
    };
    expect(ToolCapabilitySchema.safeParse(bad).success).toBe(false);
  });
});

// ── Purity refinement ────────────────────────────────────────────────

describe("ToolCapabilitySchema — purity", () => {
  it("rejects a pure tool that reads", () => {
    expect(ToolCapabilitySchema.safeParse({ ...pureMath, reads: ["entity_records"] }).success).toBe(false);
  });

  it("rejects a pure tool that writes", () => {
    const bad = { ...pureMath, writes: ["entity_records"], computeShape: "mutate" as const, locks: ["recordIds"] };
    expect(ToolCapabilitySchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a pure tool with engine-pushdown consumption", () => {
    expect(
      ToolCapabilitySchema.safeParse({ ...pureMath, consumption: { mode: "engine-pushdown" as const } }).success
    ).toBe(false);
  });

  it("rejects engine-pushdown with an empty reads[]", () => {
    expect(ToolCapabilitySchema.safeParse({ ...reader, reads: [] }).success).toBe(false);
  });
});

// ── Write refinement ─────────────────────────────────────────────────

describe("ToolCapabilitySchema — writes", () => {
  it("rejects a writing tool with no locks", () => {
    expect(ToolCapabilitySchema.safeParse({ ...writer, locks: [] }).success).toBe(false);
  });

  it("rejects a writing tool with a non-mutating computeShape", () => {
    expect(ToolCapabilitySchema.safeParse({ ...writer, computeShape: "reduce" as const }).success).toBe(false);
  });

  it("rejects mutation-result resultKind without writes", () => {
    expect(ToolCapabilitySchema.safeParse({ ...reader, resultKind: "mutation-result" as const }).success).toBe(false);
  });

  it("rejects progress resultKind without writes", () => {
    expect(ToolCapabilitySchema.safeParse({ ...reader, resultKind: "progress" as const }).success).toBe(false);
  });
});

// ── Derived role ─────────────────────────────────────────────────────

describe("deriveToolRole", () => {
  it.each([
    ["pure-math", pureMath, "none"],
    ["reader/producer", reader, "producer"],
    ["streaming reduce", streamingReduce, "consumer"],
    ["bounded reduce", boundedReduce, "consumer"],
    ["pushdown reduce", pushdownReduce, "consumer"],
    ["writer/transformer", writer, "transformer"],
  ] as const)("classifies %s", (_label, cap, role) => {
    expect(deriveToolRole(cap)).toBe(role);
  });
});
