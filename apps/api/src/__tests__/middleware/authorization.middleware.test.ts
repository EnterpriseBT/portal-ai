import { jest, describe, it, expect } from "@jest/globals";
import { Request, Response, NextFunction } from "express";
import {
  requireScope,
  requirePermission,
} from "../../middleware/authorization.middleware.js";

/** Create mock Express req/res/next */
function createMocks(authPayload?: Record<string, unknown>) {
  const req = {
    auth: authPayload ? { payload: authPayload } : undefined,
  } as unknown as Request;

  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;

  const next = jest.fn() as NextFunction;

  return { req, res, next };
}

describe("Authorization Middleware", () => {
  describe("requireScope()", () => {
    it("should call next() when all required scopes are present", () => {
      const middleware = requireScope("read:data", "write:data");
      const { req, res, next } = createMocks({
        sub: "user1",
        scope: "read:data write:data openid",
      });

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should return 403 when scope claim is missing", () => {
      const middleware = requireScope("read:data");
      const { req, res, next } = createMocks({ sub: "user1" });

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Insufficient scope" })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 403 when required scope is not granted", () => {
      const middleware = requireScope("admin:all");
      const { req, res, next } = createMocks({
        sub: "user1",
        scope: "read:data",
      });

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 403 when auth payload is undefined", () => {
      const middleware = requireScope("read:data");
      const { req, res, next } = createMocks();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("requirePermission()", () => {
    it("should call next() when all required permissions are present", () => {
      const middleware = requirePermission("delete:users");
      const { req, res, next } = createMocks({
        sub: "user1",
        permissions: ["read:users", "delete:users"],
      });

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should return 403 when required permission is missing", () => {
      const middleware = requirePermission("delete:users");
      const { req, res, next } = createMocks({
        sub: "user1",
        permissions: ["read:users"],
      });

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Insufficient permissions" })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 403 when permissions array is empty", () => {
      const middleware = requirePermission("write:data");
      const { req, res, next } = createMocks({
        sub: "user1",
        permissions: [],
      });

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should return 403 when permissions claim is undefined", () => {
      const middleware = requirePermission("read:data");
      const { req, res, next } = createMocks({ sub: "user1" });

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("should pass when multiple permissions are all present", () => {
      const middleware = requirePermission("read:users", "write:users");
      const { req, res, next } = createMocks({
        sub: "user1",
        permissions: ["read:users", "write:users", "delete:users"],
      });

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
