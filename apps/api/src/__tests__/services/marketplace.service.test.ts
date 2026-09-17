/**
 * MarketplaceService (#568) — isConfigured, the GetEntitlements converge read,
 * and dimensionToTier. The AWS SDK client is mocked; the environment is a
 * mutable stub so both configured/unconfigured branches are exercised.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockSend = jest.fn<(cmd: unknown) => Promise<unknown>>();

jest.unstable_mockModule(
  "@aws-sdk/client-marketplace-entitlement-service",
  () => ({
    MarketplaceEntitlementServiceClient: class {
      send = mockSend;
    },
    GetEntitlementsCommand: class {
      constructor(public input: unknown) {}
    },
  })
);

const mockEnv = {
  AWS_MARKETPLACE_PRODUCT_CODE: "prod-abc",
  AWS_MARKETPLACE_REGION: "us-east-1",
  SYSTEM_ID: "SYSTEM",
};
jest.unstable_mockModule("../../environment.js", () => ({ environment: mockEnv }));

const { MarketplaceService } = await import(
  "../../services/marketplace.service.js"
);

beforeEach(() => {
  jest.clearAllMocks();
  mockEnv.AWS_MARKETPLACE_PRODUCT_CODE = "prod-abc";
});

describe("MarketplaceService.isConfigured (#568)", () => {
  it("is true when the product code is set", () => {
    expect(MarketplaceService.isConfigured()).toBe(true);
  });

  it("is false when the product code is empty", () => {
    mockEnv.AWS_MARKETPLACE_PRODUCT_CODE = "";
    expect(MarketplaceService.isConfigured()).toBe(false);
  });
});

describe("MarketplaceService.dimensionToTier (#568, case 9)", () => {
  it("maps the flat dimension to the enterprise tier", () => {
    expect(MarketplaceService.dimensionToTier("enterprise")).toBe("enterprise");
  });

  it("throws on an unknown dimension", () => {
    expect(() => MarketplaceService.dimensionToTier("mystery")).toThrow(
      /Unknown AWS Marketplace dimension/
    );
  });
});

describe("MarketplaceService.getEntitlement (#568, case 8)", () => {
  it("maps a GetEntitlements response (dimension + expiration)", async () => {
    mockSend.mockResolvedValue({
      Entitlements: [
        {
          CustomerIdentifier: "cust-1",
          Dimension: "enterprise",
          ExpirationDate: new Date(1_900_000_000_000),
        },
      ],
    });

    const ent = await MarketplaceService.getEntitlement();
    expect(ent).toEqual({
      customerIdentifier: "cust-1",
      dimension: "enterprise",
      expirationDate: 1_900_000_000_000,
    });
    // the converge read is scoped to the configured product
    const cmd = mockSend.mock.calls[0]?.[0] as { input: { ProductCode: string } };
    expect(cmd.input.ProductCode).toBe("prod-abc");
  });

  it("returns null when there is no active entitlement", async () => {
    mockSend.mockResolvedValue({ Entitlements: [] });
    expect(await MarketplaceService.getEntitlement()).toBeNull();
  });

  it("returns null when the entitlement lacks a customer/dimension", async () => {
    mockSend.mockResolvedValue({ Entitlements: [{ CustomerIdentifier: "x" }] });
    expect(await MarketplaceService.getEntitlement()).toBeNull();
  });

  it("maps a null expiration to null (open-ended term)", async () => {
    mockSend.mockResolvedValue({
      Entitlements: [{ CustomerIdentifier: "cust-2", Dimension: "enterprise" }],
    });
    const ent = await MarketplaceService.getEntitlement();
    expect(ent?.expirationDate).toBeNull();
  });
});
