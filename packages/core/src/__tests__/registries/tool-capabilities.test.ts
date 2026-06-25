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
import { ToolCapabilitySchema } from "../../models/tool-capability.model.js";

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
    expect(writeGatedToolNames()).toEqual(
      em.tools.map((t) => t.name).sort()
    );
  });

  it("cost-gated == the bulk write job + the bounded heavy-compute tools", () => {
    // costHint: expensive on the two bounded reduce-tier tools (#130 E2b)
    // alongside the bulk write job. namesWhere() returns them sorted.
    expect(costGatedToolNames()).toEqual([
      "bulk_transform_entity_records",
      "cluster",
      "logistic_regression",
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
    const cap = ALL_TOOL_CAPABILITIES.bulk_transform_entity_records;
    expect(isCostGated(cap)).toBe(true);
    expect(entityLockKeys(cap).length).toBeGreaterThan(0);
  });
});
