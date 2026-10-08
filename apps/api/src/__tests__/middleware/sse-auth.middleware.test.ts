import { describe, it, expect, jest } from "@jest/globals";
import type { Request, Response, NextFunction } from "express";

const mockJwtCheck = jest.fn(
  (_req: Request, _res: Response, next: NextFunction) => next()
);
jest.unstable_mockModule("../../middleware/auth.middleware.js", () => ({
  jwtCheck: mockJwtCheck,
}));

const { sseAuth } = await import("../../middleware/sse-auth.middleware.js");

function run(query: Record<string, unknown>) {
  const req = { query, headers: {} } as unknown as Request;
  const json = jest.fn();
  const res = { status: jest.fn(() => ({ json })) } as unknown as Response;
  const next = jest.fn();
  sseAuth(req, res, next as NextFunction);
  return { req, res, next };
}

// #728: SSE takes the JWT from `?token=`. Only a plain string authenticates;
// `token[]=…` parses to an array that would stringify into a usable bearer
// while slipping past log redaction.
describe("sseAuth (#728)", () => {
  it("authenticates a plain ?token= string", () => {
    mockJwtCheck.mockClear();
    const { req, next } = run({ token: "eyJ.jwt" });
    expect(req.headers.authorization).toBe("Bearer eyJ.jwt");
    expect(mockJwtCheck).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalled();
  });

  it.each([[{ token: ["eyJ.jwt"] }], [{ token: { 0: "eyJ.jwt" } }], [{}]])(
    "refuses a missing or non-string token (%j) with 401",
    (query) => {
      mockJwtCheck.mockClear();
      const { req, res } = run(query);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(req.headers.authorization).toBeUndefined();
      expect(mockJwtCheck).not.toHaveBeenCalled();
    }
  );
});
