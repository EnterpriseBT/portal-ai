import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockAppend = jest.fn<(row: unknown) => Promise<void>>();
jest.unstable_mockModule(
  "../../db/repositories/audit-log.repository.js",
  () => ({
    auditLogRepo: { append: mockAppend },
  })
);

const mockError = jest.fn();
jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: mockError,
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Dynamic import after mocks are registered
const { AuditService, getAuditWriteFailureCount } =
  await import("../../services/audit.service.js");

// ── Helpers ──────────────────────────────────────────────────────────

const baseEvent = {
  organizationId: "org-1",
  userId: "user-1",
  action: "org.delete" as const,
  targetType: "organization",
  targetId: "org-1",
  sourceIp: "203.0.113.7",
  userAgent: "Mozilla/5.0",
  metadata: { confirmationName: "Acme" },
};

// ── Tests (spec §7) ──────────────────────────────────────────────────

describe("AuditService.record", () => {
  beforeEach(() => {
    mockAppend.mockReset();
    mockError.mockReset();
  });

  it("appends a row with the actor, action, target, ip and agent", async () => {
    mockAppend.mockResolvedValue(undefined);
    await AuditService.record({ ...baseEvent, outcome: "success" });

    expect(mockAppend).toHaveBeenCalledTimes(1);
    const row = mockAppend.mock.calls[0][0] as Record<string, unknown>;
    expect(row.organizationId).toBe("org-1");
    expect(row.userId).toBe("user-1");
    expect(row.action).toBe("org.delete");
    expect(row.targetType).toBe("organization");
    expect(row.targetId).toBe("org-1");
    expect(row.outcome).toBe("success");
    expect(row.sourceIp).toBe("203.0.113.7");
    expect(row.userAgent).toBe("Mozilla/5.0");
    expect(row.metadata).toEqual({ confirmationName: "Acme" });
    expect(row.createdBy).toBe("user-1"); // actor = createdBy
  });

  it("defaults outcome to 'success' when omitted", async () => {
    mockAppend.mockResolvedValue(undefined);
    await AuditService.record(baseEvent);

    const row = mockAppend.mock.calls[0][0] as Record<string, unknown>;
    expect(row.outcome).toBe("success");
  });

  it("defaults null target/context/metadata when omitted (a login)", async () => {
    mockAppend.mockResolvedValue(undefined);
    await AuditService.record({
      organizationId: "org-1",
      userId: "user-1",
      action: "auth.login",
    });

    const row = mockAppend.mock.calls[0][0] as Record<string, unknown>;
    expect(row.targetType).toBeNull();
    expect(row.targetId).toBeNull();
    expect(row.sourceIp).toBeNull();
    expect(row.userAgent).toBeNull();
    expect(row.metadata).toBeNull();
  });

  it("is FAIL-OPEN: a repo write failure never throws into the caller", async () => {
    mockAppend.mockRejectedValue(new Error("db down"));

    await expect(
      AuditService.record({ ...baseEvent, outcome: "failure" })
    ).resolves.toBeUndefined();
  });

  it("logs at error and bumps the failure counter on a write failure", async () => {
    const before = getAuditWriteFailureCount();
    mockAppend.mockRejectedValue(new Error("db down"));

    await AuditService.record(baseEvent);

    expect(mockError).toHaveBeenCalledTimes(1);
    expect(getAuditWriteFailureCount()).toBe(before + 1);
  });
});
