import {
  SYSTEM_TOOL_CAPABILITIES,
  ALL_TOOL_CAPABILITIES,
  alwaysAvailableToolNames,
  writeGatedToolNames,
  costGatedToolNames,
  isCostGated,
  isWriteGated,
  entityLockKeys,
} from "../../registries/tool-capabilities.js";
import { BUILTIN_TOOLPACKS } from "../../registries/builtin-toolpacks.js";
import {
  ToolCapabilitySchema,
  type CostHint,
} from "../../models/tool-capability.model.js";

describe("ALL_TOOL_CAPABILITIES", () => {
  it("covers every built-in tool plus the two system tools, all coherent", () => {
    const builtinNames = BUILTIN_TOOLPACKS.flatMap((p) =>
      p.tools.map((t) => t.name)
    );
    const expected = new Set([
      ...builtinNames,
      ...Object.keys(SYSTEM_TOOL_CAPABILITIES),
    ]);
    expect(new Set(Object.keys(ALL_TOOL_CAPABILITIES))).toEqual(expected);
    for (const cap of Object.values(ALL_TOOL_CAPABILITIES)) {
      expect(ToolCapabilitySchema.safeParse(cap).success).toBe(true);
    }
  });
});

// These three assert the metadata projections reproduce today's behavior —
// the child A acceptance criterion. Child B then wires them in, deleting the
// slug/name hardcodes they reproduce.

describe("enablement/enforcement projections reproduce current behavior", () => {
  it("always-available == today's SYSTEM_TOOL_PACKS expansion", () => {
    // tools.service.ts: SYSTEM_TOOL_PACKS = ["station_context"] → its tools.
    expect(alwaysAvailableToolNames()).toEqual([
      "current_time",
      "station_context",
    ]);
  });

  it("write-gated == every entity_management tool (today's pack-level gate)", () => {
    const em = BUILTIN_TOOLPACKS.find((p) => p.slug === "entity_management")!;
    expect(writeGatedToolNames()).toEqual(em.tools.map((t) => t.name).sort());
  });

  it("cost-gated == the transform write job + the bounded heavy-compute tools", () => {
    // costHint: expensive on the two bounded reduce-tier tools (#130 E2b)
    // alongside the transform write job. namesWhere() returns them sorted.
    expect(costGatedToolNames()).toEqual([
      "cluster",
      "logistic_regression",
      "transform_entity_records",
    ]);
  });
});

describe("predicate sanity", () => {
  it("system tools are always available and not write/cost gated", () => {
    for (const cap of Object.values(SYSTEM_TOOL_CAPABILITIES)) {
      expect(cap.alwaysAvailable).toBe(true);
      expect(isWriteGated(cap)).toBe(false);
      expect(isCostGated(cap)).toBe(false);
      expect(entityLockKeys(cap)).toEqual([]);
    }
  });

  it("the bulk write job declares both a lock and the cost gate", () => {
    const cap = ALL_TOOL_CAPABILITIES.transform_entity_records;
    expect(isCostGated(cap)).toBe(true);
    expect(entityLockKeys(cap).length).toBeGreaterThan(0);
  });
});

// #184 — pin every built-in + system tool's costHint. The type system already
// makes an omitted costHint a compile error, and attachCapabilities() throws on
// a missing capability — but a *value* drift (a billable tool flipped to "free",
// or a new metered/expensive tool shipped "free") is a valid CostHint and slips
// through silently, under-charging the org. This map is the reviewed source of
// truth: changing a tool's class, or adding/removing a tool, must be reflected
// here, and the key-set assertion forces that update to happen.
describe("costHint pin (#184)", () => {
  const EXPECTED_COST_HINTS: Record<string, CostHint> = {
    // metered — application pays a per-call third-party cost (Tavily).
    web_search: "metered",
    // expensive — bounded heavy compute + the bulk write job (cost-ack gated).
    cluster: "expensive",
    logistic_regression: "expensive",
    transform_entity_records: "expensive",
    // free — local/engine compute, pure math, entity writes, system tools.
    amortize: "free",
    bond_math: "free",
    connector_entity_create: "free",
    connector_entity_delete: "free",
    connector_entity_update: "free",
    current_time: "free",
    depreciation: "free",
    display_entity_records: "free",
    entity_record_create: "free",
    entity_record_delete: "free",
    entity_record_update: "free",
    field_mapping_create: "free",
    field_mapping_delete: "free",
    field_mapping_update: "free",
    forecast: "free",
    hypothesis_test: "free",
    irr: "free",
    npv: "free",
    portfolio_metrics: "free",
    regression: "free",
    resolve_identity: "free",
    sql_query: "free",
    station_context: "free",
    technical_indicator: "free",
    tvm: "free",
    var_cvar: "free",
    visualize: "free",
    visualize_tree: "free",
    xirr: "free",
    xnpv: "free",
  };

  it("locks each tool's costHint to the reviewed value", () => {
    for (const [name, hint] of Object.entries(EXPECTED_COST_HINTS)) {
      expect(ALL_TOOL_CAPABILITIES[name]?.costHint).toBe(hint);
    }
  });

  it("pin key-set == registry key-set (adding/removing a tool forces a pin update)", () => {
    expect(Object.keys(EXPECTED_COST_HINTS).sort()).toEqual(
      Object.keys(ALL_TOOL_CAPABILITIES).sort()
    );
  });

  it("every resolved costHint is a valid CostHint", () => {
    for (const cap of Object.values(ALL_TOOL_CAPABILITIES)) {
      expect(["free", "metered", "expensive"]).toContain(cap.costHint);
    }
  });
});
