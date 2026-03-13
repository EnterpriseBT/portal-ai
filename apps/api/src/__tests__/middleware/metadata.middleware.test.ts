import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { Request, Response, NextFunction } from "express";

import { ApiCode } from "../../constants/api-codes.constants.js";

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockFindByAuth0Id = jest.fn<(id: string) => Promise<unknown>>();
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      users: { findByAuth0Id: mockFindByAuth0Id },
    },
  },
}));

const mockGetCurrentOrganization =
  jest.fn<(userId: string) => Promise<unknown>>();
jest.unstable_mockModule("../../services/application.service.js", () => ({
  ApplicationService: {
    getCurrentOrganization: mockGetCurrentOrganization,
  },
}));

jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
}));

// Dynamic import after mocks are registered
const { getApplicationMetadata } = await import(
  "../../middleware/metadata.middleware.js"
);

// ── Helpers ────────────────────────────────────────────────────────────────

function createMocks(authPayload?: Record<string, unknown>) {
  const req = {
    auth: authPayload ? { payload: authPayload } : undefined,
  } as Request;

  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response;

  const next = jest.fn() as NextFunction;

  return { req, res, next };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("getApplicationMetadata", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should call next with error when auth payload is missing", async () => {
    const { req, res, next } = createMocks();

    await getApplicationMetadata(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 401,
        code: ApiCode.METADATA_MISSING_AUTH,
      })
    );
    expect(mockFindByAuth0Id).not.toHaveBeenCalled();
  });

  it("should call next with error when sub claim is missing", async () => {
    const { req, res, next } = createMocks({ scope: "openid" });

    await getApplicationMetadata(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 401,
        code: ApiCode.METADATA_MISSING_AUTH,
      })
    );
  });

  it("should call next with error when user is not found", async () => {
    mockFindByAuth0Id.mockResolvedValue(null);
    const { req, res, next } = createMocks({ sub: "auth0|abc123" });

    await getApplicationMetadata(req, res, next);

    expect(mockFindByAuth0Id).toHaveBeenCalledWith("auth0|abc123");
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 404,
        code: ApiCode.METADATA_USER_NOT_FOUND,
      })
    );
  });

  it("should call next with error when organization is not found", async () => {
    mockFindByAuth0Id.mockResolvedValue({ id: "user-1" });
    mockGetCurrentOrganization.mockResolvedValue(null);
    const { req, res, next } = createMocks({ sub: "auth0|abc123" });

    await getApplicationMetadata(req, res, next);

    expect(mockGetCurrentOrganization).toHaveBeenCalledWith("user-1");
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 404,
        code: ApiCode.METADATA_ORGANIZATION_NOT_FOUND,
      })
    );
  });

  it("should set req.application.metadata and call next on success", async () => {
    mockFindByAuth0Id.mockResolvedValue({ id: "user-1" });
    mockGetCurrentOrganization.mockResolvedValue({
      organization: { id: "org-1" },
      organizationUser: { id: "org-user-1" },
    });
    const { req, res, next } = createMocks({ sub: "auth0|abc123" });

    await getApplicationMetadata(req, res, next);

    expect(req.application).toEqual({
      metadata: {
        userId: "user-1",
        organizationId: "org-1",
      },
    });
    expect(next).toHaveBeenCalledWith();
  });

  it("should call next with 500 error when an unexpected error occurs", async () => {
    mockFindByAuth0Id.mockRejectedValue(new Error("DB connection failed"));
    const { req, res, next } = createMocks({ sub: "auth0|abc123" });

    await getApplicationMetadata(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 500,
        code: ApiCode.METADATA_FETCH_FAILED,
      })
    );
  });
});
