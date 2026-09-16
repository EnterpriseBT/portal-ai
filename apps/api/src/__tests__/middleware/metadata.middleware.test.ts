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
const mockEnsureProvisioned =
  jest.fn<
    (
      sub: string,
      resolveProfile: () => Promise<unknown>,
      auditCtx?: unknown
    ) => Promise<unknown>
  >();
jest.unstable_mockModule("../../services/application.service.js", () => ({
  ApplicationService: {
    getCurrentOrganization: mockGetCurrentOrganization,
    ensureProvisioned: mockEnsureProvisioned,
    // #577: the returning-user branch fires this fire-and-forget; a no-op keeps
    // the happy-path assertions focused on the metadata it attaches.
    recordLoginIfNewSession: jest.fn(async () => undefined),
  },
}));

const mockGetAuth0UserProfile = jest.fn<(token: string) => Promise<unknown>>();
jest.unstable_mockModule("../../services/auth0.service.js", () => ({
  Auth0Service: {
    getAccessToken: jest.fn(() => "access-token"),
    getAuth0UserProfile: mockGetAuth0UserProfile,
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
const { getApplicationMetadata } =
  await import("../../middleware/metadata.middleware.js");

// ── Helpers ────────────────────────────────────────────────────────────────

function createMocks(authPayload?: Record<string, unknown>) {
  const req = {
    auth: authPayload ? { payload: authPayload } : undefined,
    headers: { authorization: "Bearer access-token" },
    ip: "203.0.113.7",
    get: (_name: string) => "jest-agent",
  } as unknown as Request;

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

  // case 9: no user → self-heal provisions on the request path (#583)
  it("provisions and proceeds when no user row exists (self-heal, not 404)", async () => {
    mockFindByAuth0Id.mockResolvedValue(null);
    mockEnsureProvisioned.mockResolvedValue({
      user: { id: "user-1" },
      organization: { id: "org-1" },
      organizationUser: { role: "owner" },
      created: true,
    });
    const { req, res, next } = createMocks({ sub: "auth0|abc123" });

    await getApplicationMetadata(req, res, next);

    expect(mockEnsureProvisioned).toHaveBeenCalledTimes(1);
    expect(mockEnsureProvisioned.mock.calls[0][0]).toBe("auth0|abc123");
    expect(mockEnsureProvisioned.mock.calls[0][2]).toEqual({
      sourceIp: "203.0.113.7",
      userAgent: "jest-agent",
    });
    expect(req.application).toEqual({
      metadata: {
        userId: "user-1",
        organizationId: "org-1",
        role: "owner",
      },
    });
    expect(next).toHaveBeenCalledWith();
  });

  // case 10: user exists but no membership → self-heal provisions
  it("provisions and proceeds when the user has no membership", async () => {
    mockFindByAuth0Id.mockResolvedValue({ id: "user-1" });
    mockGetCurrentOrganization.mockResolvedValue(null);
    mockEnsureProvisioned.mockResolvedValue({
      user: { id: "user-1" },
      organization: { id: "org-1" },
      organizationUser: { role: "owner" },
      created: true,
    });
    const { req, res, next } = createMocks({ sub: "auth0|abc123" });

    await getApplicationMetadata(req, res, next);

    expect(mockGetCurrentOrganization).toHaveBeenCalledWith("user-1");
    expect(mockEnsureProvisioned).toHaveBeenCalledTimes(1);
    expect(req.application?.metadata.organizationId).toBe("org-1");
    expect(next).toHaveBeenCalledWith();
  });

  // case 11: happy path incurs no provisioning work
  it("sets metadata (incl. role) and does NOT provision on the happy path", async () => {
    mockFindByAuth0Id.mockResolvedValue({ id: "user-1" });
    mockGetCurrentOrganization.mockResolvedValue({
      organization: { id: "org-1" },
      organizationUser: { id: "org-user-1", role: "admin" },
    });
    const { req, res, next } = createMocks({ sub: "auth0|abc123" });

    await getApplicationMetadata(req, res, next);

    expect(req.application).toEqual({
      metadata: {
        userId: "user-1",
        organizationId: "org-1",
        role: "admin",
      },
    });
    expect(mockEnsureProvisioned).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  // case 12: Auth0 profile fetch fails on the miss path → fail-closed 500
  it("fails closed (500) when the Auth0 profile fetch throws", async () => {
    mockFindByAuth0Id.mockResolvedValue(null);
    // The real ensureProvisioned invokes resolveProfile to create the user;
    // model that so the Auth0 fetch failure surfaces through it.
    mockEnsureProvisioned.mockImplementation(async (_sub, resolveProfile) => {
      await resolveProfile();
      return {} as never;
    });
    mockGetAuth0UserProfile.mockRejectedValue(new Error("auth0 userinfo 503"));
    const { req, res, next } = createMocks({ sub: "auth0|abc123" });

    await getApplicationMetadata(req, res, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 500,
        code: ApiCode.METADATA_FETCH_FAILED,
      })
    );
    expect(req.application).toBeUndefined();
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
