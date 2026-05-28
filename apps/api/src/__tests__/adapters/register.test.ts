import { describe, it, expect, beforeEach } from "@jest/globals";

import { ConnectorAdapterRegistry } from "../../adapters/adapter.registry.js";
import { registerAdapters } from "../../adapters/register.js";

describe("registerAdapters", () => {
  beforeEach(() => {
    ConnectorAdapterRegistry.clear();
  });

  it("registers all four adapter slugs", () => {
    registerAdapters();
    const slugs = ConnectorAdapterRegistry.slugs().sort();
    expect(slugs).toEqual([
      "google-sheets",
      "microsoft-excel",
      "rest-api",
      "sandbox",
    ]);
  });

  it("microsoft-excel adapter exposes syncInstance + assertSyncEligibility", () => {
    registerAdapters();
    const adapter = ConnectorAdapterRegistry.get("microsoft-excel");
    expect(typeof adapter.syncInstance).toBe("function");
    expect(typeof adapter.assertSyncEligibility).toBe("function");
    expect(typeof adapter.toPublicAccountInfo).toBe("function");
  });

  it("rest-api adapter exposes syncInstance + testConnection + toPublicAccountInfo", () => {
    registerAdapters();
    const adapter = ConnectorAdapterRegistry.get("rest-api");
    expect(typeof adapter.syncInstance).toBe("function");
    expect(typeof adapter.testConnection).toBe("function");
    expect(typeof adapter.toPublicAccountInfo).toBe("function");
  });
});
