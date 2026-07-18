import { describe, it, expect } from "@jest/globals";
import {
  ToolUsageLedgerEntrySchema,
  ToolUsageLedgerEntryModel,
  ToolUsageLedgerEntryModelFactory,
} from "../../models/tool-usage-ledger.model.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validFields = {
  organizationId: "org-1",
  toolName: "web_search",
  toolCallId: "call_abc123",
  stationId: "station-1",
  portalId: "portal-1",
  costClass: "metered" as const,
  units: 1,
  periodId: "2026-07",
  userId: "user-1",
};

// ── Tests (spec case 1) ──────────────────────────────────────────────

describe("ToolUsageLedgerEntrySchema", () => {
  it("round-trips through the factory with audit fields", () => {
    const parsed = new ToolUsageLedgerEntryModelFactory()
      .create("SYSTEM")
      .update(validFields)
      .parse();

    expect(parsed.toolName).toBe("web_search");
    expect(parsed.toolCallId).toBe("call_abc123");
    expect(parsed.costClass).toBe("metered");
    expect(parsed.units).toBe(1);
    expect(parsed.periodId).toBe("2026-07");
    expect(parsed.userId).toBe("user-1");
    expect(parsed.createdBy).toBe("SYSTEM");
    expect(ToolUsageLedgerEntrySchema.safeParse(parsed).success).toBe(true);
  });

  it("accepts a null portalId (job-deferred charge without a portal)", () => {
    const model = new ToolUsageLedgerEntryModelFactory()
      .create("SYSTEM")
      .update({ ...validFields, portalId: null, toolCallId: "job:j-1" });

    expect(model.validate().success).toBe(true);
  });

  it("rejects costClass 'free' — free calls never commit a charge", () => {
    const model = new ToolUsageLedgerEntryModelFactory()
      .create("SYSTEM")
      .update({ ...validFields, costClass: "free" as never });

    expect(model.validate().success).toBe(false);
  });

  it("rejects non-positive units", () => {
    for (const units of [0, -1]) {
      const model = new ToolUsageLedgerEntryModelFactory()
        .create("SYSTEM")
        .update({ ...validFields, units });
      expect(model.validate().success).toBe(false);
    }
  });

  it("rejects a missing toolCallId (the dedup key)", () => {
    const { toolCallId: _omitted, ...rest } = validFields;
    const model = new ToolUsageLedgerEntryModelFactory()
      .create("SYSTEM")
      .update(rest);

    expect(model.validate().success).toBe(false);
  });

  it("exposes the schema via the model getter", () => {
    const shape = new ToolUsageLedgerEntryModel({}).schema.shape;
    expect(shape).toHaveProperty("toolCallId");
    expect(shape).toHaveProperty("costClass");
    expect(shape).toHaveProperty("periodId");
  });
});
