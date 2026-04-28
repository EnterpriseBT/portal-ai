import { describe, it, expect } from "@jest/globals";

import * as pkg from "../index.js";
import * as replayPkg from "../replay/index.js";

describe("@portalai/spreadsheet-parsing — main (browser-safe) entry", () => {
  it("exports PLAN_VERSION as semver string 1.0.0", () => {
    expect(pkg.PLAN_VERSION).toBe("1.0.0");
  });

  it("exports placeholder schemas", () => {
    expect(pkg.LayoutPlanSchema).toBeDefined();
    expect(pkg.RegionSchema).toBeDefined();
    expect(pkg.WorkbookSchema).toBeDefined();
  });

  it("exports placeholder WarningCode enum", () => {
    expect(pkg.WarningCode).toBeDefined();
    expect(typeof pkg.WarningCode).toBe("object");
  });

  it("exports interpret() as a real async function (Phase 3+)", () => {
    expect(typeof pkg.interpret).toBe("function");
  });

  it("does NOT re-export replay() from the main entry (lives under /replay)", () => {
    expect((pkg as Record<string, unknown>).replay).toBeUndefined();
  });
});

describe("@portalai/spreadsheet-parsing/replay — node-only subpath", () => {
  it("exports replay() as a real function", () => {
    expect(typeof replayPkg.replay).toBe("function");
  });
});
