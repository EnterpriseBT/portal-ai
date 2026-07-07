import { describe, it, expect, afterEach } from "@jest/globals";
import {
  resolveCallCost,
  registerCostResolver,
  COST_RESOLVERS,
} from "../../services/cost-gate.service.js";

// Keep the shared registry clean between cases.
afterEach(() => {
  for (const key of Object.keys(COST_RESOLVERS)) delete COST_RESOLVERS[key];
});

describe("resolveCallCost", () => {
  it("defaults to 1 unit for an unregistered tool", async () => {
    await expect(resolveCallCost("web_search", { query: "x" })).resolves.toBe(1);
  });

  it("uses a registered resolver's value", async () => {
    registerCostResolver("fixed_tool", () => 3);
    await expect(resolveCallCost("fixed_tool", {})).resolves.toBe(3);
  });

  it("supports a fan-out resolver that returns f(N) from the input", async () => {
    // Mimics a tool whose cost scales with input row count.
    registerCostResolver(
      "geocode",
      (input) => (input as { rows: unknown[] }).rows.length
    );
    await expect(
      resolveCallCost("geocode", { rows: [1, 2, 3, 4, 5] })
    ).resolves.toBe(5);
  });

  it("supports an async resolver (e.g. reading a query-handle rowCount)", async () => {
    registerCostResolver("streaming_tool", async () => Promise.resolve(7));
    await expect(resolveCallCost("streaming_tool", {})).resolves.toBe(7);
  });

  it("registerCostResolver overrides an existing entry by name", async () => {
    registerCostResolver("t", () => 1);
    registerCostResolver("t", () => 9);
    await expect(resolveCallCost("t", {})).resolves.toBe(9);
  });
});
