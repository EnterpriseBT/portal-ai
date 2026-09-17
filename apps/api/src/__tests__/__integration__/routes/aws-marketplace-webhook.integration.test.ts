/**
 * POST /api/webhooks/aws-marketplace (#568) — the SNS entitlement webhook.
 *
 * SNS signature validation, TierGrantService.apply, and MarketplaceService are
 * mocked so the route's control flow is asserted directly: config gate,
 * SubscriptionConfirmation, signature rejection, and Notification dispatch.
 */
import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterAll,
} from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";

import { ApiCode } from "../../../constants/api-codes.constants.js";

process.env.AWS_MARKETPLACE_PRODUCT_CODE ??= "prod-int-test";

// ── Mocks ────────────────────────────────────────────────────────────

let mockValidateOk = true;
jest.unstable_mockModule("sns-validator", () => ({
  default: class {
    validate(message: unknown, cb: (err: Error | null, m?: unknown) => void) {
      if (mockValidateOk) cb(null, message);
      else cb(new Error("signature mismatch"));
    }
  },
}));

let mockIsConfigured = true;
jest.unstable_mockModule("../../../services/marketplace.service.js", () => ({
  MarketplaceService: { isConfigured: () => mockIsConfigured },
}));

const mockApply =
  jest.fn<(...args: unknown[]) => Promise<string>>().mockResolvedValue("applied");
jest.unstable_mockModule("../../../services/tier-grant.service.js", () => ({
  TierGrantService: { apply: mockApply },
  StripeGrantSource: class {},
  AwsMarketplaceGrantSource: class {},
}));

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: "auth0|marketplace-webhook-test" } } as never;
    next();
  },
}));
jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

const { app } = await import("../../../app.js");

const ROUTE = "/api/webhooks/aws-marketplace";
const fetchSpy = jest
  .fn<typeof fetch>()
  .mockResolvedValue({ ok: true } as never);
global.fetch = fetchSpy as typeof fetch;

function post(message: Record<string, unknown>) {
  return request(app)
    .post(ROUTE)
    .set("Content-Type", "text/plain")
    .send(JSON.stringify(message));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockValidateOk = true;
  mockIsConfigured = true;
  mockApply.mockResolvedValue("applied");
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe("POST /api/webhooks/aws-marketplace (#568)", () => {
  it("case 18 — 404s when the marketplace rail is not configured", async () => {
    mockIsConfigured = false;
    const res = await post({ Type: "Notification", MessageId: "m1" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.MARKETPLACE_NOT_CONFIGURED);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("case 16 — confirms a SubscriptionConfirmation via the SubscribeURL", async () => {
    const res = await post({
      Type: "SubscriptionConfirmation",
      MessageId: "m-confirm",
      SubscribeURL: "https://sns.example/confirm?token=abc",
    });
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://sns.example/confirm?token=abc"
    );
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("case 17 — a valid Notification dispatches apply", async () => {
    const res = await post({
      Type: "Notification",
      MessageId: "m-notify",
      Subject: "entitlement-updated",
    });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("applied");
    expect(mockApply).toHaveBeenCalledTimes(1);
  });

  it("case 17 — an invalid signature is rejected 400, no dispatch", async () => {
    mockValidateOk = false;
    const res = await post({ Type: "Notification", MessageId: "m-forged" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.MARKETPLACE_SIGNATURE_INVALID);
    expect(mockApply).not.toHaveBeenCalled();
  });
});
