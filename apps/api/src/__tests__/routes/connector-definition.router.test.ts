import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
} from "@jest/globals";
import type { Request, Response, NextFunction } from "express";
import { ApiCode } from "../../constants/api-codes.constants.js";

// ── Mocks ──────────────────────────────────────────────────────────────

const mockFindMany = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockCount = jest.fn<(...args: unknown[]) => Promise<number>>();
const mockFindById = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorDefinitions: {
        findMany: mockFindMany,
        count: mockCount,
        findById: mockFindById,
      },
    },
  },
}));

// Mock auth middleware
jest.unstable_mockModule("../../middleware/auth.middleware.js", () => ({
  jwtCheck: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock Auth0Service (required by protected router)
jest.unstable_mockModule("../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

// Dynamic import after mocks are registered
const { app } = await import("../../app.js");
const request = (await import("supertest")).default;

// ── Helpers ────────────────────────────────────────────────────────────

function buildDefinition(overrides?: Record<string, unknown>) {
  return {
    id: "def-1",
    slug: "test-connector",
    display: "Test Connector",
    category: "database",
    authType: "oauth2",
    configSchema: null,
    capabilityFlags: { sync: true, query: true, write: false },
    isActive: true,
    version: "1.0.0",
    iconUrl: null,
    created: 1700000000000,
    createdBy: "SYSTEM",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("Connector Definition Router", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── GET / ──────────────────────────────────────────────────────────

  describe("GET /api/connector-definitions", () => {
    it("should return a paginated list of connector definitions", async () => {
      const defs = [buildDefinition(), buildDefinition({ id: "def-2", display: "Other" })];
      mockFindMany.mockResolvedValue(defs);
      mockCount.mockResolvedValue(2);

      const res = await request(app)
        .get("/api/connector-definitions")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.connectorDefinitions).toHaveLength(2);
      expect(res.body.payload.total).toBe(2);
      expect(res.body.payload.limit).toBe(20);
      expect(res.body.payload.offset).toBe(0);
    });

    it("should return an empty list when no definitions exist", async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      const res = await request(app)
        .get("/api/connector-definitions")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.connectorDefinitions).toEqual([]);
      expect(res.body.payload.total).toBe(0);
    });

    it("should pass parsed limit and offset to the repository", async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await request(app)
        .get("/api/connector-definitions?limit=5&offset=10")
        .set("Authorization", "Bearer test-token");

      expect(mockFindMany).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({ limit: 5, offset: 10 })
      );
    });

    it("should pass sort parameters to the repository", async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await request(app)
        .get("/api/connector-definitions?sortBy=category&sortOrder=desc")
        .set("Authorization", "Bearer test-token");

      expect(mockFindMany).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          orderBy: expect.objectContaining({ direction: "desc" }),
        })
      );
    });

    it("should build filter conditions for category", async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await request(app)
        .get("/api/connector-definitions?category=api")
        .set("Authorization", "Bearer test-token");

      // When a filter is supplied, the where clause should be defined (not undefined)
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Object)
      );
    });

    it("should build filter conditions for authType", async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await request(app)
        .get("/api/connector-definitions?authType=api_key")
        .set("Authorization", "Bearer test-token");

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Object)
      );
    });

    it("should build filter conditions for isActive", async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await request(app)
        .get("/api/connector-definitions?isActive=true")
        .set("Authorization", "Bearer test-token");

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Object)
      );
    });

    it("should build filter conditions for search", async () => {
      mockFindMany.mockResolvedValue([]);
      mockCount.mockResolvedValue(0);

      await request(app)
        .get("/api/connector-definitions?search=postgres")
        .set("Authorization", "Bearer test-token");

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Object)
      );
    });

    it("should return 500 when the repository throws", async () => {
      mockFindMany.mockRejectedValue(new Error("DB down"));
      mockCount.mockRejectedValue(new Error("DB down"));

      const res = await request(app)
        .get("/api/connector-definitions")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_DEFINITION_FETCH_FAILED);
    });
  });

  // ── GET /:id ───────────────────────────────────────────────────────

  describe("GET /api/connector-definitions/:id", () => {
    it("should return a connector definition by ID", async () => {
      const def = buildDefinition();
      mockFindById.mockResolvedValue(def);

      const res = await request(app)
        .get("/api/connector-definitions/def-1")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.connectorDefinition.id).toBe("def-1");
      expect(res.body.payload.connectorDefinition.display).toBe("Test Connector");
      expect(mockFindById).toHaveBeenCalledWith("def-1");
    });

    it("should return 404 when definition is not found", async () => {
      mockFindById.mockResolvedValue(null);

      const res = await request(app)
        .get("/api/connector-definitions/nonexistent")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_DEFINITION_NOT_FOUND);
    });

    it("should return 500 when the repository throws", async () => {
      mockFindById.mockRejectedValue(new Error("DB down"));

      const res = await request(app)
        .get("/api/connector-definitions/def-1")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_DEFINITION_FETCH_FAILED);
    });
  });
});
