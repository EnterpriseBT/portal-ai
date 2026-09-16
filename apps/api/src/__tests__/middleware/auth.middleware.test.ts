import { jest, describe, it, expect } from "@jest/globals";
import type { Request, Response, NextFunction } from "express";

import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

/**
 * Slice 2 (#577): the multi-issuer dispatcher. We mock the per-issuer
 * validator factory (`auth`) with an identifiable stub and mock `SsoConfig`,
 * so the test drives routing logic without a real JWKS/token.
 */
async function loadJwtCheck(
  issuers: { issuer: string; audience: string; alg: string }[]
) {
  jest.resetModules();
  jest.unstable_mockModule("../../config/sso.config.js", () => ({
    SsoConfig: { issuers: () => issuers },
  }));
  jest.unstable_mockModule("express-oauth2-jwt-bearer", () => ({
    auth:
      (opts: { issuer: string }) =>
      (
        req: Request & { validatedBy?: string },
        _res: Response,
        next: NextFunction
      ) => {
        req.validatedBy = opts.issuer;
        next();
      },
  }));
  const mod = await import("../../middleware/auth.middleware.js");
  return mod.jwtCheck;
}

function tokenWithIss(iss: unknown): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(iss === undefined ? {} : { iss })}.sig`;
}

const ISSUERS = [
  { issuer: "https://portalai.us.auth0.com/", audience: "a", alg: "RS256" },
  { issuer: "https://customer.okta.com/", audience: "b", alg: "RS256" },
];

function mockReq(authorization?: string): Request & { validatedBy?: string } {
  return { headers: authorization ? { authorization } : {} } as Request & {
    validatedBy?: string;
  };
}

describe("jwtCheck multi-issuer dispatch", () => {
  it("routes a token to the validator matching its iss", async () => {
    const jwtCheck = await loadJwtCheck(ISSUERS);
    const req = mockReq(`Bearer ${tokenWithIss("https://customer.okta.com/")}`);
    const next = jest.fn();
    jwtCheck(req, {} as Response, next as unknown as NextFunction);
    expect(req.validatedBy).toBe("https://customer.okta.com/");
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects a well-formed token whose issuer is not configured", async () => {
    const jwtCheck = await loadJwtCheck(ISSUERS);
    const req = mockReq(`Bearer ${tokenWithIss("https://evil.example.com/")}`);
    const next = jest.fn();
    jwtCheck(req, {} as Response, next as unknown as NextFunction);
    // Note: `instanceof ApiError` can't be asserted across the resetModules
    // boundary (the dynamically-loaded middleware has its own ApiError class);
    // status + code (a string enum) compare correctly regardless.
    const err = next.mock.calls[0][0] as ApiError;
    expect(err.status).toBe(401);
    expect(err.code).toBe(ApiCode.SSO_UNKNOWN_ISSUER);
    expect(req.validatedBy).toBeUndefined();
  });

  it("rejects a missing or malformed token with AUTH_UNAUTHORIZED", async () => {
    const jwtCheck = await loadJwtCheck(ISSUERS);
    // No Authorization header
    const missing = jest.fn();
    jwtCheck(mockReq(), {} as Response, missing as unknown as NextFunction);
    expect((missing.mock.calls[0][0] as ApiError).code).toBe(
      ApiCode.AUTH_UNAUTHORIZED
    );
    // Present but undecodable (no iss claim)
    const malformed = jest.fn();
    jwtCheck(
      mockReq(`Bearer ${tokenWithIss(undefined)}`),
      {} as Response,
      malformed as unknown as NextFunction
    );
    expect((malformed.mock.calls[0][0] as ApiError).code).toBe(
      ApiCode.AUTH_UNAUTHORIZED
    );
  });
});
