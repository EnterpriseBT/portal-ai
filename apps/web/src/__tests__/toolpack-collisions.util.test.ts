import type { Toolpack } from "@portalai/core/contracts";

import { detectToolpackCollisions } from "../utils/toolpack-collisions.util";

// ── Helpers ──────────────────────────────────────────────────────────

function buildCustom(overrides: {
  id: string;
  name: string;
  toolNames: string[];
}): Toolpack {
  return {
    id: overrides.id,
    kind: "custom",
    slug: overrides.name,
    name: overrides.name,
    description: null,
    iconSlug: "Extension",
    tools: overrides.toolNames.map((n) => ({
      name: n,
      description: `${n} description`,
      parameterSchema: { type: "object", properties: {} },
    })),
    endpoints: {
      schema: "https://example.com/schema",
      runtime: "https://example.com/runtime",
    },
    authHeadersStatus: { has: false },
    signingSecretStatus: { has: true },
    schemaFetchedAt: 0,
    metadataFetchedAt: null,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("detectToolpackCollisions", () => {
  // Case 120
  it("returns empty for a non-colliding selection of built-ins", () => {
    const result = detectToolpackCollisions(["data_query", "statistics"], []);
    expect(result).toEqual([]);
  });

  // Case 121
  it("flags two custom packs that share a tool name", () => {
    const customs = [
      buildCustom({
        id: "otp-a",
        name: "customer_intel",
        toolNames: ["lookup_company"],
      }),
      buildCustom({
        id: "otp-b",
        name: "sales_intel",
        toolNames: ["lookup_company"],
      }),
    ];
    const result = detectToolpackCollisions(
      ["org:otp-a", "org:otp-b"],
      customs
    );
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe("lookup_company");
    expect(result[0].ownerLabels).toEqual(["customer_intel", "sales_intel"]);
  });

  // Case 122
  it("flags a built-in vs. custom collision when the custom pack shadows a built-in tool", () => {
    const customs = [
      buildCustom({
        id: "otp-c",
        name: "rogue_pack",
        toolNames: ["sql_query"],
      }),
    ];
    const result = detectToolpackCollisions(
      ["data_query", "org:otp-c"],
      customs
    );
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe("sql_query");
    expect(result[0].ownerLabels).toContain("rogue_pack");
    expect(
      result[0].ownerLabels.some((l) => l.toLowerCase().includes("data"))
    ).toBe(true);
  });

  // Case 123
  it("silently skips unresolvable refs", () => {
    const result = detectToolpackCollisions(
      ["org:does-not-exist", "data_query"],
      []
    );
    expect(result).toEqual([]);
  });

  it("sorts collisions by tool name alphabetically", () => {
    const customs = [
      buildCustom({
        id: "otp-a",
        name: "pack_alpha",
        toolNames: ["zebra_tool", "apple_tool"],
      }),
      buildCustom({
        id: "otp-b",
        name: "pack_beta",
        toolNames: ["zebra_tool", "apple_tool"],
      }),
    ];
    const result = detectToolpackCollisions(
      ["org:otp-a", "org:otp-b"],
      customs
    );
    expect(result.map((c) => c.toolName)).toEqual(["apple_tool", "zebra_tool"]);
  });
});
