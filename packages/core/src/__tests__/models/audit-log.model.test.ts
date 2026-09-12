import { describe, it, expect } from "@jest/globals";
import {
  AUDIT_ACTIONS,
  AuditLogEntrySchema,
  AuditLogEntryModel,
  AuditLogEntryModelFactory,
} from "../../models/audit-log.model.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validFields = {
  organizationId: "org-1",
  userId: "user-1",
  action: "org.delete" as const,
  targetType: "organization",
  targetId: "org-1",
  outcome: "success" as const,
  sourceIp: "203.0.113.7",
  userAgent: "Mozilla/5.0",
  metadata: { confirmationName: "Acme" },
};

// ── Tests (spec: core model plan) ────────────────────────────────────

describe("AuditLogEntrySchema", () => {
  it("round-trips through the factory with the actor as createdBy", () => {
    const parsed = new AuditLogEntryModelFactory()
      .create("user-1")
      .update(validFields)
      .parse();

    expect(parsed.action).toBe("org.delete");
    expect(parsed.userId).toBe("user-1");
    expect(parsed.targetType).toBe("organization");
    expect(parsed.targetId).toBe("org-1");
    expect(parsed.outcome).toBe("success");
    expect(parsed.sourceIp).toBe("203.0.113.7");
    expect(parsed.userAgent).toBe("Mozilla/5.0");
    expect(parsed.metadata).toEqual({ confirmationName: "Acme" });
    expect(parsed.createdBy).toBe("user-1");
    expect(AuditLogEntrySchema.safeParse(parsed).success).toBe(true);
  });

  it("accepts null target/context/metadata (a login with no target)", () => {
    const model = new AuditLogEntryModelFactory().create("user-1").update({
      ...validFields,
      action: "auth.login" as const,
      targetType: null,
      targetId: null,
      sourceIp: null,
      userAgent: null,
      metadata: null,
    });

    expect(model.validate().success).toBe(true);
  });

  it("accepts every declared AuditAction", () => {
    for (const action of AUDIT_ACTIONS) {
      const model = new AuditLogEntryModelFactory()
        .create("user-1")
        .update({ ...validFields, action });
      expect(model.validate().success).toBe(true);
    }
  });

  it("rejects an unknown action", () => {
    const model = new AuditLogEntryModelFactory()
      .create("user-1")
      .update({ ...validFields, action: "org.explode" as never });

    expect(model.validate().success).toBe(false);
  });

  it("rejects an unknown outcome", () => {
    const model = new AuditLogEntryModelFactory()
      .create("user-1")
      .update({ ...validFields, outcome: "maybe" as never });

    expect(model.validate().success).toBe(false);
  });

  it("rejects a missing action", () => {
    const { action: _omitted, ...rest } = validFields;
    const model = new AuditLogEntryModelFactory().create("user-1").update(rest);

    expect(model.validate().success).toBe(false);
  });

  it("exposes the schema via the model getter", () => {
    const shape = new AuditLogEntryModel({}).schema.shape;
    expect(shape).toHaveProperty("action");
    expect(shape).toHaveProperty("outcome");
    expect(shape).toHaveProperty("sourceIp");
    expect(shape).toHaveProperty("metadata");
  });
});
