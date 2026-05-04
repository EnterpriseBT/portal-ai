import { describe, it, expect, beforeEach } from "@jest/globals";

import { ConnectorAdapterRegistry } from "../../adapters/adapter.registry.js";
import { registerAdapters } from "../../adapters/register.js";

describe("registerAdapters", () => {
  beforeEach(() => {
    ConnectorAdapterRegistry.clear();
  });

  it("registers all three adapter slugs", () => {
    registerAdapters();
    const slugs = ConnectorAdapterRegistry.slugs().sort();
    expect(slugs).toEqual(["google-sheets", "microsoft-excel", "sandbox"]);
  });

  it("microsoft-excel adapter exposes syncInstance + assertSyncEligibility", () => {
    registerAdapters();
    const adapter = ConnectorAdapterRegistry.get("microsoft-excel");
    expect(typeof adapter.syncInstance).toBe("function");
    expect(typeof adapter.assertSyncEligibility).toBe("function");
    expect(typeof adapter.toPublicAccountInfo).toBe("function");
  });
});
