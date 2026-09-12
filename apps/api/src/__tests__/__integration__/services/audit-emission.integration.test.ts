/**
 * Integration tests for audit emission at the security seams (#575, slice 4).
 *
 * Verifies (a) a representative seam (org.delete via the route) writes an
 * audit_log row with the right actor/target/outcome, and (b) fail-open
 * end-to-end: when the audit write fails, the audited action still succeeds.
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
import { and, eq, sql } from "drizzle-orm";
import type { User } from "@portalai/core/models";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApplicationService } from "../../../services/application.service.js";
import { auditLogRepo } from "../../../db/repositories/audit-log.repository.js";
import { generateId, teardownOrg } from "../utils/application.util.js";

const AUTH0_ID = "auth0|audit-emit-user";

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

const { auditLog } = schema;

async function purgeAuditLog(client: ReturnType<typeof drizzle>) {
  await client.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.audit_retention_purge = 'on'`);
    await tx.delete(auditLog);
  });
}

describe("Audit emission (#575 slice 4)", () => {
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
    jest.restoreAllMocks();
    await purgeAuditLog(db as ReturnType<typeof drizzle>);
    await connection.end();
  });

  function createOwner(overrides?: Partial<User>): User {
    const now = Date.now();
    return {
      id: generateId(),
      auth0Id: AUTH0_ID,
      email: `owner-${generateId()}@example.com`,
      name: "Emit Owner",
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

  it("org.delete via the route writes an audit_log row (actor + target + outcome)", async () => {
    const result = await ApplicationService.setupOrganization(createOwner());
    const org = result.organization;

    const res = await request(app)
      .delete(`/api/organization/${org.id}`)
      .set("Authorization", "Bearer test-token")
      .send({ confirmationName: org.name });

    expect(res.status).toBe(200);

    // Give the fire-and-forget emission a tick to land.
    await new Promise((r) => setTimeout(r, 50));

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.organizationId, org.id),
          eq(auditLog.action, "org.delete")
        )
      );

    expect(rows).toHaveLength(1);
    expect(rows[0].targetType).toBe("organization");
    expect(rows[0].targetId).toBe(org.id);
    expect(rows[0].outcome).toBe("success");
    expect(rows[0].userId).toBe(result.user.id); // the actor
  });

  it("is FAIL-OPEN end-to-end: the delete succeeds even when the audit write throws", async () => {
    const result = await ApplicationService.setupOrganization(createOwner());
    const org = result.organization;

    // Force the audit write to fail; the destructive action must still commit.
    jest
      .spyOn(auditLogRepo, "append")
      .mockRejectedValue(new Error("audit store down"));

    const res = await request(app)
      .delete(`/api/organization/${org.id}`)
      .set("Authorization", "Bearer test-token")
      .send({ confirmationName: org.name });

    expect(res.status).toBe(200);

    // The org was actually deleted (tombstoned) despite the audit failure.
    const [orgRow] = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, org.id));
    expect(orgRow.deleted).not.toBeNull();
  });
});
