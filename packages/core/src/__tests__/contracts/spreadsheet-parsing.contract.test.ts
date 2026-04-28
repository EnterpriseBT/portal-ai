import { describe, it, expect } from "@jest/globals";

import * as contractsBarrel from "../../contracts/index.js";
import {
  LayoutPlanSchema as LayoutPlanSchemaFromContracts,
  RegionSchema as RegionSchemaFromContracts,
  WorkbookSchema as WorkbookSchemaFromContracts,
  WarningCode as WarningCodeFromContracts,
  PLAN_VERSION as PLAN_VERSION_FROM_CONTRACTS,
} from "../../contracts/index.js";
import {
  LayoutPlanSchema as LayoutPlanSchemaFromModule,
  RegionSchema as RegionSchemaFromModule,
  WorkbookSchema as WorkbookSchemaFromModule,
  WarningCode as WarningCodeFromModule,
  PLAN_VERSION as PLAN_VERSION_FROM_MODULE,
} from "@portalai/spreadsheet-parsing";

describe("@portalai/core/contracts — spreadsheet-parsing re-exports", () => {
  it("re-exports LayoutPlanSchema as the exact symbol from the parser module", () => {
    expect(LayoutPlanSchemaFromContracts).toBe(LayoutPlanSchemaFromModule);
  });

  it("re-exports RegionSchema as the exact symbol from the parser module", () => {
    expect(RegionSchemaFromContracts).toBe(RegionSchemaFromModule);
  });

  it("re-exports WorkbookSchema as the exact symbol from the parser module", () => {
    expect(WorkbookSchemaFromContracts).toBe(WorkbookSchemaFromModule);
  });

  it("re-exports WarningCode as the exact symbol from the parser module", () => {
    expect(WarningCodeFromContracts).toBe(WarningCodeFromModule);
  });

  it("re-exports PLAN_VERSION as the exact constant from the parser module", () => {
    expect(PLAN_VERSION_FROM_CONTRACTS).toBe(PLAN_VERSION_FROM_MODULE);
    expect(PLAN_VERSION_FROM_CONTRACTS).toBe("1.0.0");
  });

  it("does NOT re-export `replay` — it lives in the Node-only /replay subpath", () => {
    // Keeping `replay` out of this barrel keeps the contracts entry
    // browser-safe (Storybook / web bundles don't pull node:crypto).
    expect((contractsBarrel as Record<string, unknown>).replay).toBeUndefined();
  });
});
