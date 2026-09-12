/**
 * Integration tests for GET /api/organization/audit-log (#575, slice 3).
 *
 * Owner-gated read of the org's audit trail. Rows are seeded directly (the
 * emission path is slice 4); this suite verifies the endpoint's authz,
 * org-scoping, filters, pagination, and query validation.
 */

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
import { sql } from "drizzle-orm";
import type { User } from "@portalai/core/models";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { ApplicationService } from "../../../services/application.service.js";
import { generateId, teardownOrg } from "../utils/application.util.js";

const AUTH0_ID = "auth0|audit-log-user";

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      req.auth = { payload: { sub: AUTH0_ID } } as never;
    }
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

const { auditLog, users, organizations, organizationUsers } = schema;

/** audit_log's append-only trigger blocks plain DELETE — cleanup opts in. */
async function purgeAuditLog(client: ReturnType<typeof drizzle>) {
  await client.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.audit_retention_purge = 'on'`);
    await tx.delete(auditLog);
  });
}

describe("GET /api/organization/audit-log (#575 slice 3)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await purgeAuditLog(db as ReturnType<typeof drizzle>);
    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await purgeAuditLog(db as ReturnType<typeof drizzle>);
    await connection.end();
  });

  function createOwner(overrides?: Partial<User>): User {
    const now = Date.now();
    return {
      id: generateId(),
      auth0Id: AUTH0_ID,
      email: `owner-${generateId()}@example.com`,
      name: "Audit Owner",
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

  async function seedAuditRow(
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
      userId: "user-1",
      action: "org.delete",
      targetType: "organization",
      targetId: organizationId,
      outcome: "success",
      sourceIp: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      metadata: { note: "seed" },
      ...over,
    };
    await (db as ReturnType<typeof drizzle>)
      .insert(auditLog)
      .values(row as never);
    return row;
  }

  /** An org owned by someone else, with the caller (AUTH0_ID) a mere member
   *  and this org as their current org — the non-owner authz case. */
  async function seedOrgWhereCallerIsMember(): Promise<string> {
    const now = Date.now();
    const ownerId = generateId();
    await (db as ReturnType<typeof drizzle>).insert(users).values({
      id: ownerId,
      auth0Id: `auth0|real-owner-${generateId()}`,
      email: `realowner-${generateId()}@example.com`,
      name: "Real Owner",
      lastLogin: now,
      picture: null,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    const callerId = generateId();
    await (db as ReturnType<typeof drizzle>).insert(users).values({
      id: callerId,
      auth0Id: AUTH0_ID,
      email: `member-${generateId()}@example.com`,
      name: "Member Caller",
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
      name: "Members Org",
      timezone: "UTC",
      ownerUserId: ownerId,
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
      userId: callerId,
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

  it("returns the owner's org rows newest-first with total; respects limit/offset", async () => {
    const result = await ApplicationService.setupOrganization(createOwner());
    const orgId = result.organization.id;

    const base = Date.now();
    await seedAuditRow(orgId, { action: "org.create", created: base - 3000 });
    await seedAuditRow(orgId, {
      action: "member.add",
      created: base - 2000,
    });
    await seedAuditRow(orgId, { action: "auth.login", created: base - 1000 });

    const res = await request(app)
      .get("/api/organization/audit-log")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payload.total).toBe(3);
    expect(
      res.body.payload.entries.map((e: { action: string }) => e.action)
    ).toEqual(["auth.login", "member.add", "org.create"]);

    const page2 = await request(app)
      .get("/api/organization/audit-log?limit=1&offset=1")
      .set("Authorization", "Bearer test-token");
    expect(page2.status).toBe(200);
    expect(page2.body.payload.total).toBe(3);
    expect(page2.body.payload.entries).toHaveLength(1);
    expect(page2.body.payload.entries[0].action).toBe("member.add");
  });

  it("filters by action and outcome; unknown sortBy → 400", async () => {
    const result = await ApplicationService.setupOrganization(createOwner());
    const orgId = result.organization.id;

    await seedAuditRow(orgId, { action: "org.create", outcome: "success" });
    await seedAuditRow(orgId, {
      action: "toolpack.secret.rotate",
      outcome: "failure",
    });

    const byAction = await request(app)
      .get("/api/organization/audit-log?action=toolpack.secret.rotate")
      .set("Authorization", "Bearer test-token");
    expect(byAction.status).toBe(200);
    expect(byAction.body.payload.total).toBe(1);
    expect(byAction.body.payload.entries[0].action).toBe(
      "toolpack.secret.rotate"
    );

    const byOutcome = await request(app)
      .get("/api/organization/audit-log?outcome=failure")
      .set("Authorization", "Bearer test-token");
    expect(byOutcome.status).toBe(200);
    expect(byOutcome.body.payload.total).toBe(1);

    const badSort = await request(app)
      .get("/api/organization/audit-log?sortBy=sourceIp")
      .set("Authorization", "Bearer test-token");
    expect(badSort.status).toBe(400);
    expect(badSort.body.code).toBe(ApiCode.AUDIT_LOG_INVALID_QUERY);

    const badAction = await request(app)
      .get("/api/organization/audit-log?action=org.explode")
      .set("Authorization", "Bearer test-token");
    expect(badAction.status).toBe(400);
    expect(badAction.body.code).toBe(ApiCode.AUDIT_LOG_INVALID_QUERY);
  });

  it("denies a non-owner member with 403 AUDIT_LOG_NOT_AUTHORIZED", async () => {
    const orgId = await seedOrgWhereCallerIsMember();
    await seedAuditRow(orgId, { action: "org.create" });

    const res = await request(app)
      .get("/api/organization/audit-log")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.AUDIT_LOG_NOT_AUTHORIZED);
  });

  it("401s without authentication", async () => {
    const res = await request(app).get("/api/organization/audit-log");
    expect(res.status).toBe(401);
  });
});
