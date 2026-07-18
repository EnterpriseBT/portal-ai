import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { User } from "@portalai/core/models";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { ApplicationService } from "../../../services/application.service.js";
import { generateId, teardownOrg } from "../utils/application.util.js";

const AUTH0_ID = "auth0|usage-ledger-user";

// Mock the auth middleware to populate req.auth with our test sub. A
// request without an Authorization header gets no req.auth, so the route
// (behind getApplicationMetadata) 401s with METADATA_MISSING_AUTH — the
// closest mockable analogue of the real jwtCheck rejection.
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      req.auth = { payload: { sub: AUTH0_ID } } as never;
    }
    next();
  },
}));

// Mock Auth0Service (required by profile router which shares the protected router)
jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

const { app } = await import("../../../app.js");

const { toolUsageLedger, users, organizations, organizationUsers } = schema;

describe("GET /api/organization/usage/ledger (#179 slice 3)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await connection.end();
  });

  function createOwner(overrides?: Partial<User>): User {
    const now = Date.now();
    return {
      id: generateId(),
      auth0Id: AUTH0_ID,
      email: `owner-${generateId()}@example.com`,
      name: "Ledger Owner",
      lastLogin: now,
      picture: null,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    };
  }

  /** Seed one ledger row directly (the write path is slice 2's concern). */
  async function seedLedgerRow(
    organizationId: string,
    over: Partial<Record<string, unknown>> = {}
  ) {
    const row = {
      id: generateId(),
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId,
      toolName: "web_search",
      toolCallId: `call_${generateId()}`,
      stationId: "station-1",
      portalId: null,
      costClass: "metered",
      units: 1,
      periodId: "2026-07",
      userId: "user-1",
      ...over,
    };
    await (db as ReturnType<typeof drizzle>)
      .insert(toolUsageLedger)
      .values(row as never);
    return row;
  }

  /** A second org (different owner/auth0 sub) for the isolation case. */
  async function seedOtherOrg(): Promise<string> {
    const now = Date.now();
    const userId = generateId();
    await (db as ReturnType<typeof drizzle>).insert(users).values({
      id: userId,
      auth0Id: `auth0|other-${generateId()}`,
      email: `other-${generateId()}@example.com`,
      name: "Other User",
      lastLogin: now,
      picture: null,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    const orgId = generateId();
    await (db as ReturnType<typeof drizzle>).insert(organizations).values({
      id: orgId,
      name: "Other Org",
      timezone: "UTC",
      ownerUserId: userId,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    await (db as ReturnType<typeof drizzle>).insert(organizationUsers).values({
      id: generateId(),
      organizationId: orgId,
      userId,
      lastLogin: now,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return orgId;
  }

  // case 14 — newest-first page + total; limit/offset respected
  it("returns the org's rows newest-first with total; respects limit/offset", async () => {
    const owner = createOwner();
    const result = await ApplicationService.setupOrganization(owner);
    const orgId = result.organization.id;

    const base = Date.now();
    await seedLedgerRow(orgId, { toolName: "oldest", created: base - 3000 });
    await seedLedgerRow(orgId, { toolName: "middle", created: base - 2000 });
    await seedLedgerRow(orgId, { toolName: "newest", created: base - 1000 });

    const res = await request(app)
      .get("/api/organization/usage/ledger")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payload.total).toBe(3);
    expect(
      res.body.payload.entries.map((e: { toolName: string }) => e.toolName)
    ).toEqual(["newest", "middle", "oldest"]);

    // limit/offset page through the same ordering; total is page-independent.
    const page2 = await request(app)
      .get("/api/organization/usage/ledger?limit=1&offset=1")
      .set("Authorization", "Bearer test-token");

    expect(page2.status).toBe(200);
    expect(page2.body.payload.total).toBe(3);
    expect(page2.body.payload.entries).toHaveLength(1);
    expect(page2.body.payload.entries[0].toolName).toBe("middle");
  });

  // case 15 — filters + sortBy allow-map
  it("filters by periodId + toolName; unknown sortBy → 400", async () => {
    const owner = createOwner();
    const result = await ApplicationService.setupOrganization(owner);
    const orgId = result.organization.id;

    await seedLedgerRow(orgId, { toolName: "web_search", periodId: "2026-06" });
    await seedLedgerRow(orgId, { toolName: "web_search", periodId: "2026-07" });
    await seedLedgerRow(orgId, { toolName: "geocode", periodId: "2026-07" });

    const byPeriod = await request(app)
      .get("/api/organization/usage/ledger?periodId=2026-07")
      .set("Authorization", "Bearer test-token");
    expect(byPeriod.status).toBe(200);
    expect(byPeriod.body.payload.total).toBe(2);

    const byBoth = await request(app)
      .get(
        "/api/organization/usage/ledger?periodId=2026-07&toolName=web_search"
      )
      .set("Authorization", "Bearer test-token");
    expect(byBoth.status).toBe(200);
    expect(byBoth.body.payload.total).toBe(1);
    expect(byBoth.body.payload.entries[0].toolName).toBe("web_search");
    expect(byBoth.body.payload.entries[0].periodId).toBe("2026-07");

    // Search: case-insensitive substring on the tool name.
    const bySearch = await request(app)
      .get("/api/organization/usage/ledger?search=GEO")
      .set("Authorization", "Bearer test-token");
    expect(bySearch.status).toBe(200);
    expect(bySearch.body.payload.total).toBe(1);
    expect(bySearch.body.payload.entries[0].toolName).toBe("geocode");

    // sortBy outside the allow-map is a 400, not a silent default.
    const badSort = await request(app)
      .get("/api/organization/usage/ledger?sortBy=portalId")
      .set("Authorization", "Bearer test-token");
    expect(badSort.status).toBe(400);
    expect(badSort.body.code).toBe(ApiCode.USAGE_LEDGER_INVALID_QUERY);
  });

  // case 16 — org isolation + anon rejection
  it("never returns another org's rows; rejects anonymous callers", async () => {
    const owner = createOwner();
    const result = await ApplicationService.setupOrganization(owner);
    const orgId = result.organization.id;

    const otherOrgId = await seedOtherOrg();
    await seedLedgerRow(orgId, { toolName: "mine" });
    await seedLedgerRow(otherOrgId, { toolName: "theirs" });

    const res = await request(app)
      .get("/api/organization/usage/ledger")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.payload.total).toBe(1);
    expect(res.body.payload.entries[0].toolName).toBe("mine");

    const anon = await request(app).get("/api/organization/usage/ledger");
    expect(anon.status).toBe(401);
    expect(anon.body.code).toBe(ApiCode.METADATA_MISSING_AUTH);
  });
});
