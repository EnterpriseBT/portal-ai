/**
 * Unit tests for `OrganizationUpdateService.syncStripeCustomerName` (#907),
 * the post-commit, best-effort Stripe name sync, and
 * `auditDefaultStationChange` (#935). `apply` runs against the real
 * database in the integration suite.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockIsConfigured = jest.fn<() => boolean>();
const mockUpdateCustomerName =
  jest.fn<(id: string, name: string) => Promise<void>>();

jest.unstable_mockModule("../../services/stripe.service.js", () => ({
  StripeService: {
    isConfigured: mockIsConfigured,
    updateCustomerName: mockUpdateCustomerName,
  },
}));

const mockFindById =
  jest.fn<(id: string) => Promise<Record<string, unknown> | undefined>>();
const mockStationFindById =
  jest.fn<(id: string) => Promise<Record<string, unknown> | undefined>>();
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      organizations: { findById: mockFindById },
      stations: { findById: mockStationFindById },
    },
  },
}));

const mockRecord = jest.fn<(event: unknown) => Promise<void>>();
jest.unstable_mockModule("../../services/audit.service.js", () => ({
  AuditService: { record: mockRecord },
}));

const mockWarn = jest.fn();
jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({ warn: mockWarn, info: jest.fn(), error: jest.fn() }),
}));

const { OrganizationUpdateService } =
  await import("../../services/organization-update.service.js");

const storedOrg = (stripeCustomerId: string | null, name = "Acme Corp") => ({
  id: "org-1",
  name,
  stripeCustomerId,
});

beforeEach(() => {
  mockIsConfigured.mockReset().mockReturnValue(true);
  mockUpdateCustomerName.mockReset().mockResolvedValue(undefined);
  mockWarn.mockReset();
  mockFindById.mockReset().mockResolvedValue(storedOrg("cus_1"));
  mockRecord.mockReset().mockResolvedValue(undefined);
  mockStationFindById
    .mockReset()
    .mockImplementation(async (id: string) =>
      id === "st-a"
        ? { id, name: "Main" }
        : id === "st-b"
          ? { id, name: "Sales" }
          : undefined
    );
});

describe("OrganizationUpdateService.auditDefaultStationChange (#935)", () => {
  const context = {
    userId: "user-1",
    organizationId: "org-1",
    sourceIp: "127.0.0.1",
    userAgent: "jest",
  };

  it("records org.update with both ids and the names as of the change", async () => {
    await OrganizationUpdateService.auditDefaultStationChange(
      context,
      "org-1",
      "st-a",
      "st-b"
    );

    expect(mockRecord).toHaveBeenCalledWith({
      ...context,
      action: "org.update",
      targetType: "organization",
      targetId: "org-1",
      metadata: {
        field: "defaultStationId",
        from: "st-a",
        to: "st-b",
        fromName: "Main",
        toName: "Sales",
      },
    });
  });

  it("uses a name the caller passes, without reading the station", async () => {
    await OrganizationUpdateService.auditDefaultStationChange(
      context,
      "org-1",
      "st-gone",
      null,
      { fromName: "Archived" }
    );

    expect(mockStationFindById).not.toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          field: "defaultStationId",
          from: "st-gone",
          to: null,
          fromName: "Archived",
          toName: null,
        },
      })
    );
  });

  it("still records the entry, without the name, when the lookup fails", async () => {
    mockStationFindById.mockRejectedValue(new Error("db down"));

    await OrganizationUpdateService.auditDefaultStationChange(
      context,
      "org-1",
      null,
      "st-b"
    );

    expect(mockWarn).toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ to: "st-b", toName: null }),
      })
    );
  });
});

describe("OrganizationUpdateService.syncStripeCustomerName (#907)", () => {
  it("sets the customer's name when the org has one", async () => {
    await OrganizationUpdateService.syncStripeCustomerName("org-1");
    expect(mockFindById).toHaveBeenCalledWith("org-1");
    expect(mockUpdateCustomerName).toHaveBeenCalledWith("cus_1", "Acme Corp");
  });

  it("sends the name as stored when it runs, not the one it was started for", async () => {
    // A later rename committed before this sync read the row: Stripe gets the
    // newest name whichever sync finishes last.
    mockFindById.mockResolvedValue(storedOrg("cus_1", "Acme Industries"));
    await OrganizationUpdateService.syncStripeCustomerName("org-1");
    expect(mockUpdateCustomerName).toHaveBeenCalledWith(
      "cus_1",
      "Acme Industries"
    );
  });

  it("does nothing for an org with no Stripe customer", async () => {
    mockFindById.mockResolvedValue(storedOrg(null));
    await OrganizationUpdateService.syncStripeCustomerName("org-1");
    expect(mockUpdateCustomerName).not.toHaveBeenCalled();
  });

  it("does nothing when Stripe isn't configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    await OrganizationUpdateService.syncStripeCustomerName("org-1");
    expect(mockUpdateCustomerName).not.toHaveBeenCalled();
  });

  it("logs a warning and resolves when Stripe fails", async () => {
    mockUpdateCustomerName.mockRejectedValue(new Error("stripe down"));
    await expect(
      OrganizationUpdateService.syncStripeCustomerName("org-1")
    ).resolves.toBeUndefined();
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        stripeCustomerId: "cus_1",
        error: "stripe down",
      }),
      expect.stringContaining("reconcile manually")
    );
  });
});
