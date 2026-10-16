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
});
