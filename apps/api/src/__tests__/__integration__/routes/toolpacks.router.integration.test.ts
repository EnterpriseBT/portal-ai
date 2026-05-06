import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { seedUserAndOrg, teardownOrg } from "../utils/application.util.js";

const AUTH0_ID = "auth0|toolpacks-router-test";

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: AUTH0_ID } } as never;
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

describe("Toolpacks Router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db as ReturnType<typeof drizzle>);
    await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);
  });

  afterEach(async () => {
    await connection.end();
  });

  describe("GET /api/toolpacks", () => {
    // Case 36
    it("returns the six built-in toolpacks", async () => {
      const res = await request(app).get("/api/toolpacks");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.toolpacks).toHaveLength(6);
      expect(res.body.payload.total).toBe(6);
      const slugs = (res.body.payload.toolpacks as { slug: string }[]).map(
        (t) => t.slug
      );
      expect(slugs.sort()).toEqual(
        [
          "data_query",
          "entity_management",
          "financial",
          "regression",
          "statistics",
          "web_search",
        ].sort()
      );
      for (const t of res.body.payload.toolpacks) {
        expect(t.kind).toBe("builtin");
        expect(t.id).toBe(`builtin:${t.slug}`);
        expect(Array.isArray(t.tools)).toBe(true);
      }
    });

    // Case 37
    it("returns an empty list when filtering for kind=custom", async () => {
      const res = await request(app).get("/api/toolpacks?kind=custom");
      expect(res.status).toBe(200);
      expect(res.body.payload.toolpacks).toEqual([]);
      expect(res.body.payload.total).toBe(0);
    });

    // Case 38
    it("filters by tool description on the search query", async () => {
      // `correlate` is in the statistics pack and its description mentions "correlation"
      const res = await request(app).get("/api/toolpacks?search=correl");
      expect(res.status).toBe(200);
      const slugs = (res.body.payload.toolpacks as { slug: string }[]).map(
        (t) => t.slug
      );
      expect(slugs).toContain("statistics");
      expect(slugs).not.toContain("data_query");
    });
  });

  describe("GET /api/toolpacks/:id", () => {
    // Case 39
    it("returns the requested built-in pack by id", async () => {
      const res = await request(app).get("/api/toolpacks/builtin:data_query");
      expect(res.status).toBe(200);
      expect(res.body.payload.toolpack.slug).toBe("data_query");
      expect(res.body.payload.toolpack.kind).toBe("builtin");
      expect(
        (res.body.payload.toolpack.tools as { name: string }[]).map(
          (t) => t.name
        )
      ).toContain("sql_query");
    });

    // Case 40
    it("404s for an unknown built-in slug", async () => {
      const res = await request(app).get(
        "/api/toolpacks/builtin:does_not_exist"
      );
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.TOOLPACK_NOT_FOUND);
    });

    // Case 41
    it("404s for a custom: prefix in phase 1", async () => {
      const res = await request(app).get(
        "/api/toolpacks/custom:any-uuid-here"
      );
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.TOOLPACK_NOT_FOUND);
    });

    // Case 42
    it("404s for an un-prefixed id", async () => {
      const res = await request(app).get("/api/toolpacks/data_query");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.TOOLPACK_NOT_FOUND);
    });
  });
});
