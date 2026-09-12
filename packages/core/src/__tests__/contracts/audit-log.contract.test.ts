import { describe, it, expect } from "@jest/globals";
import {
  AuditLogListRequestQuerySchema,
  AuditLogListResponseSchema,
} from "../../contracts/audit-log.contract.js";

// ── Tests (spec: contract plan) ──────────────────────────────────────

describe("AuditLogListRequestQuerySchema", () => {
  it("coerces pagination strings and accepts optional action/outcome filters", () => {
    const parsed = AuditLogListRequestQuerySchema.parse({
      limit: "25",
      offset: "50",
      sortBy: "created",
      sortOrder: "asc",
      action: "toolpack.secret.rotate",
      outcome: "failure",
    });

    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(50);
    expect(parsed.action).toBe("toolpack.secret.rotate");
    expect(parsed.outcome).toBe("failure");
  });

  it("applies pagination defaults with no filters (newest-first)", () => {
    const parsed = AuditLogListRequestQuerySchema.parse({});
    expect(parsed.sortBy).toBe("created");
    expect(parsed.sortOrder).toBe("desc"); // newest-first default

    expect(parsed.action).toBeUndefined();
    expect(parsed.outcome).toBeUndefined();
  });

  it("rejects an unknown action filter", () => {
    expect(
      AuditLogListRequestQuerySchema.safeParse({ action: "org.explode" })
        .success
    ).toBe(false);
  });
});

describe("AuditLogListResponseSchema", () => {
  it("parses a representative page and requires total", () => {
    const entry = {
      id: "a-1",
      created: 1_784_000_000_000,
      createdBy: "user-1",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      userId: "user-1",
      action: "org.delete",
      targetType: "organization",
      targetId: "org-1",
      outcome: "success",
      sourceIp: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      metadata: { confirmationName: "Acme" },
    };

    expect(
      AuditLogListResponseSchema.safeParse({ entries: [entry], total: 1 })
        .success
    ).toBe(true);
    expect(
      AuditLogListResponseSchema.safeParse({ entries: [], total: 0 }).success
    ).toBe(true);
    expect(
      AuditLogListResponseSchema.safeParse({ entries: [entry] }).success
    ).toBe(false); // total required
  });
});
