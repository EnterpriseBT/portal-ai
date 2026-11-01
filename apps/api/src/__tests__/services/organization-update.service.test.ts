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

const mockWarn = jest.fn();
jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({ warn: mockWarn, info: jest.fn(), error: jest.fn() }),
}));

const { OrganizationUpdateService } =
  await import("../../services/organization-update.service.js");

const org = (stripeCustomerId: string | null) =>
  ({ id: "org-1", name: "Acme Corp", stripeCustomerId }) as never;

beforeEach(() => {
  mockIsConfigured.mockReset().mockReturnValue(true);
  mockUpdateCustomerName.mockReset().mockResolvedValue(undefined);
  mockWarn.mockReset();
});

describe("OrganizationUpdateService.syncStripeCustomerName (#907)", () => {
  it("sets the customer's name when the org has one", async () => {
    await OrganizationUpdateService.syncStripeCustomerName(org("cus_1"));
    expect(mockUpdateCustomerName).toHaveBeenCalledWith("cus_1", "Acme Corp");
  });

  it("does nothing for an org with no Stripe customer", async () => {
    await OrganizationUpdateService.syncStripeCustomerName(org(null));
    expect(mockUpdateCustomerName).not.toHaveBeenCalled();
  });

  it("does nothing when Stripe isn't configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    await OrganizationUpdateService.syncStripeCustomerName(org("cus_1"));
    expect(mockUpdateCustomerName).not.toHaveBeenCalled();
  });

  it("logs a warning and resolves when Stripe fails", async () => {
    mockUpdateCustomerName.mockRejectedValue(new Error("stripe down"));
    await expect(
      OrganizationUpdateService.syncStripeCustomerName(org("cus_1"))
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
