import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import request from "supertest";
import express, { Request, Response, NextFunction } from "express";

// ── Mocks ────────────────────────────────────────────────────────────

const mockSearch = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../../services/search.service.js", () => ({
  SearchService: { search: mockSearch },
}));

jest.unstable_mockModule("../../middleware/metadata.middleware.js", () => ({
  getApplicationMetadata: (
    req: Request,
    _res: Response,
    next: NextFunction
  ) => {
    req.application = {
      metadata: { organizationId: "org-001", userId: "user-001" },
    } as never;
    next();
  },
}));

const { searchRouter } = await import("../../routes/search.router.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

// ── App setup ────────────────────────────────────────────────────────

const app = express();
app.use("/api/search", searchRouter);
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test's stand-in for the global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(err.status ?? 500).json({
    success: false,
    code: err.code ?? "UNKNOWN",
    message: err.message,
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSearch.mockResolvedValue({ results: [] });
});

describe("GET /api/search (#1076)", () => {
  it.each([
    ["two modes", "?q=a&tag=b"],
    ["over-long text", `?q=${"x".repeat(121)}`],
    ["a malformed ref", "?refs=station"],
    ["an unknown key", "?search=a"],
  ])("answers 400 SEARCH_INVALID_QUERY for %s", async (_label, qs) => {
    const res = await request(app).get(`/api/search${qs}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.SEARCH_INVALID_QUERY);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("passes the parsed query and the caller to SearchService", async () => {
    mockSearch.mockResolvedValueOnce({
      results: [{ type: "station", id: "s1", name: "Sales", tags: [] }],
    });
    const res = await request(app).get("/api/search?q=%20sales%20");
    expect(res.status).toBe(200);
    expect(res.body.payload.results).toHaveLength(1);
    expect(mockSearch).toHaveBeenCalledWith(
      { organizationId: "org-001", userId: "user-001" },
      { q: "sales" }
    );
  });

  it("answers favorites when no mode is given", async () => {
    await request(app).get("/api/search").expect(200);
    expect(mockSearch).toHaveBeenCalledWith(expect.anything(), {});
  });
});
