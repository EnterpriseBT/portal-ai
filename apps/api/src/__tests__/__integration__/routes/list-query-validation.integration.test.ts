import { jest, describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import { seedUserAndOrg, teardownOrg } from "../utils/application.util.js";

/**
 * #756: a list query its schema refuses is a 400 naming the field, with the
 * issues in `details` (#745's `invalidPayload`), not a 500 with an unrelated
 * `*_NOT_FOUND` code.
 */

const AUTH0_ID = "auth0|list-query-validation";

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

/** Each list endpoint with a value its schema refuses, and the field named. */
const CASES: Array<{
  path: string;
  query: string;
  field: string;
  code: string;
}> = [
  {
    path: "/api/portals",
    query: "limit=abc",
    field: "limit",
    code: "PORTAL_INVALID_QUERY",
  },
  {
    path: "/api/portal-results",
    query: "offset=-1",
    field: "offset",
    code: "PORTAL_RESULT_INVALID_QUERY",
  },
  {
    path: "/api/stations",
    query: "sortOrder=sideways",
    field: "sortOrder",
    code: "STATION_INVALID_QUERY",
  },
  {
    path: "/api/jobs",
    query: "limit=0",
    field: "limit",
    code: "JOB_INVALID_QUERY",
  },
  {
    path: "/api/entity-tags",
    query: "limit=abc",
    field: "limit",
    code: "ENTITY_TAG_INVALID_QUERY",
  },
  {
    path: "/api/connector-entities",
    query: "limit=abc",
    field: "limit",
    code: "CONNECTOR_ENTITY_INVALID_QUERY",
  },
  {
    path: "/api/field-mappings",
    query: "limit=abc",
    field: "limit",
    code: "FIELD_MAPPING_INVALID_QUERY",
  },
  {
    path: "/api/curated-views",
    query: "limit=abc",
    field: "limit",
    code: "CURATED_VIEW_INVALID_QUERY",
  },
  {
    path: "/api/connector-definitions",
    query: "limit=abc",
    field: "limit",
    code: "CONNECTOR_DEFINITION_INVALID_QUERY",
  },
  {
    path: "/api/entity-groups",
    query: "limit=abc",
    field: "limit",
    code: "ENTITY_GROUP_INVALID_QUERY",
  },
  {
    path: "/api/connector-instances",
    query: "limit=abc",
    field: "limit",
    code: "CONNECTOR_INSTANCE_INVALID_QUERY",
  },
  {
    path: "/api/column-definitions",
    query: "limit=abc",
    field: "limit",
    code: "COLUMN_DEFINITION_INVALID_QUERY",
  },
  // Not paginated: its refusable field is `kind`.
  {
    path: "/api/toolpacks",
    query: "kind=nope",
    field: "kind",
    code: "TOOLPACK_INVALID_QUERY",
  },
];

/** Each paginated list's allowed `sortBy` values, from its schema's enum. */
const SORTS: Array<{ path: string; code: string; values: string[] }> = [
  {
    path: "/api/portals",
    code: "PORTAL_INVALID_QUERY",
    values: ["created", "lastOpened"],
  },
  {
    path: "/api/portal-results",
    code: "PORTAL_RESULT_INVALID_QUERY",
    values: ["created"],
  },
  {
    path: "/api/stations",
    code: "STATION_INVALID_QUERY",
    values: ["name", "created"],
  },
  {
    path: "/api/jobs",
    code: "JOB_INVALID_QUERY",
    values: ["created", "status", "type"],
  },
  {
    path: "/api/entity-tags",
    code: "ENTITY_TAG_INVALID_QUERY",
    values: ["name", "created"],
  },
  {
    path: "/api/connector-entities",
    code: "CONNECTOR_ENTITY_INVALID_QUERY",
    values: ["key", "label", "created"],
  },
  {
    path: "/api/field-mappings",
    code: "FIELD_MAPPING_INVALID_QUERY",
    values: ["sourceField", "created"],
  },
  {
    path: "/api/curated-views",
    code: "CURATED_VIEW_INVALID_QUERY",
    values: ["label", "key", "created"],
  },
  {
    path: "/api/connector-definitions",
    code: "CONNECTOR_DEFINITION_INVALID_QUERY",
    values: ["display", "category", "slug", "created", "version"],
  },
  {
    path: "/api/entity-groups",
    code: "ENTITY_GROUP_INVALID_QUERY",
    values: ["name", "created"],
  },
  {
    path: "/api/connector-instances",
    code: "CONNECTOR_INSTANCE_INVALID_QUERY",
    values: ["name", "status", "created"],
  },
  {
    path: "/api/column-definitions",
    code: "COLUMN_DEFINITION_INVALID_QUERY",
    values: ["key", "label", "type", "created"],
  },
];

describe("malformed list queries answer 400 (#756)", () => {
  let connection!: ReturnType<typeof postgres>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    const db = drizzle(connection, { schema });
    await teardownOrg(db);
    await seedUserAndOrg(db, AUTH0_ID);
  });

  afterAll(async () => {
    await connection.end();
  });

  it.each(CASES)(
    "$path?$query → 400 $code naming $field",
    async ({ path, query, field, code }) => {
      const res = await request(app).get(`${path}?${query}`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(code);
      expect(res.body.message).toContain(field);
      expect(res.body.details.issues[0].path).toEqual([field]);
      expect(res.body.details.issueCount).toBeGreaterThanOrEqual(1);
    }
  );

  it.each(CASES)("$path with no query still answers 200", async ({ path }) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
  });

  // Code review: an unknown sortBy fell back to `created` silently, and an
  // inherited name like `constructor` found Object's own member in the column
  // map and failed as a 500. The schema refuses both now.
  describe.each(SORTS)("$path sortBy", ({ path, code, values }) => {
    it.each(["bogus", "constructor", "__proto__"])(
      "sortBy=%s → 400 naming sortBy",
      async (value) => {
        const res = await request(app).get(`${path}?sortBy=${value}`);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe(code);
        expect(res.body.details.issues[0].path).toEqual(["sortBy"]);
      }
    );

    it("every allowed sortBy answers 200", async () => {
      for (const value of values) {
        for (const order of ["asc", "desc"]) {
          const res = await request(app).get(
            `${path}?sortBy=${value}&sortOrder=${order}`
          );
          expect([value, order, res.status]).toEqual([value, order, 200]);
        }
      }
    });
  });

  // Code review: a repeated `include` arrives as an array, and `.split` on it
  // threw a TypeError that became a 500.
  it.each([
    { path: "/api/stations", code: "STATION_INVALID_QUERY" },
    { path: "/api/portals", code: "PORTAL_INVALID_QUERY" },
  ])(
    "$path/:id with a repeated include → 400 $code",
    async ({ path, code }) => {
      const res = await request(app).get(
        `${path}/does-not-matter?include=a&include=b`
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe(code);
      expect(res.body.details.issues[0].path).toEqual(["include"]);
    }
  );
});
