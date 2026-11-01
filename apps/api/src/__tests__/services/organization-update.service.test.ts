/**
 * Unit tests for `OrganizationUpdateService.syncStripeCustomerName` (#907):
 * the post-commit, best-effort Stripe name sync. `apply` runs against the real
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
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { organizations: { findById: mockFindById } } },
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
