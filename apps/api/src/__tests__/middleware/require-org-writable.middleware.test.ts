/**
 * requireOrgWritable (#568, case 19) — the marketplace read-only write-gate.
 *
 * DbService + ApplicationService are mocked so the gate is asserted as a pure
 * function of method, path, and the resolved org's term. Fail-closed on a
 * definitively-expired term; fail-open on a lookup failure.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Request, Response, NextFunction } from "express";

const mockFindByAuth0Id = jest.fn<() => Promise<unknown>>();
const mockGetCurrentOrganization = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { users: { findByAuth0Id: mockFindByAuth0Id } } },
}));
jest.unstable_mockModule("../../services/application.service.js", () => ({
  ApplicationService: { getCurrentOrganization: mockGetCurrentOrganization },
}));

const { requireOrgWritable } =
  await import("../../middleware/require-org-writable.middleware.js");
const { ApiError } = await import("../../services/http.service.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

const PAST = Date.now() - 86_400_000;
const FUTURE = Date.now() + 86_400_000;

function makeReq(method: string, path = "/stations"): Request {
  return {
    method,
    path,
    auth: { payload: { sub: "auth0|writable-test" } },
  } as unknown as Request;
}

function run(req: Request): Promise<unknown> {
  return new Promise((resolve) => {
    requireOrgWritable(
      req,
      {} as Response,
      ((err?: unknown) => resolve(err)) as NextFunction
    );
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindByAuth0Id.mockResolvedValue({ id: "user-1" });
});

describe("requireOrgWritable (#568)", () => {
  it("allows a GET on a read-only org (reads are never gated)", async () => {
    mockGetCurrentOrganization.mockResolvedValue({
      organization: { entitlementThrough: PAST },
    });
    const err = await run(makeReq("GET"));
    expect(err).toBeUndefined();
  });

  it("blocks a POST on a read-only org (403 ORG_ENTITLEMENT_EXPIRED)", async () => {
    mockGetCurrentOrganization.mockResolvedValue({
      organization: { entitlementThrough: PAST },
    });
    const err = await run(makeReq("POST"));
    expect(err).toBeInstanceOf(ApiError);
    expect((err as InstanceType<typeof ApiError>).code).toBe(
      ApiCode.ORG_ENTITLEMENT_EXPIRED
    );
  });

  it("blocks a DELETE on a read-only org", async () => {
    mockGetCurrentOrganization.mockResolvedValue({
      organization: { entitlementThrough: PAST },
    });
    const err = await run(makeReq("DELETE"));
    expect((err as InstanceType<typeof ApiError>).code).toBe(
      ApiCode.ORG_ENTITLEMENT_EXPIRED
    );
  });

  it("allows a POST on a writable org (future term)", async () => {
    mockGetCurrentOrganization.mockResolvedValue({
      organization: { entitlementThrough: FUTURE },
    });
    const err = await run(makeReq("POST"));
    expect(err).toBeUndefined();
  });

  it("allows a POST on a SaaS org (null term)", async () => {
    mockGetCurrentOrganization.mockResolvedValue({
      organization: { entitlementThrough: null },
    });
    const err = await run(makeReq("POST"));
    expect(err).toBeUndefined();
  });

  it("allows a POST when there is no auth subject (downstream auth handles it)", async () => {
    const req = {
      method: "POST",
      path: "/stations",
      auth: undefined,
    } as unknown as Request;
    const err = await run(req);
    expect(err).toBeUndefined();
    expect(mockFindByAuth0Id).not.toHaveBeenCalled();
  });

  it("fails OPEN on a lookup failure (does not 403 a healthy write)", async () => {
    mockGetCurrentOrganization.mockRejectedValue(new Error("db down"));
    const err = await run(makeReq("POST"));
    expect(err).toBeUndefined();
  });
});
