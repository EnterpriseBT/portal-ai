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
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|jobs-test-user";

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

const { jobs } = schema;

// ── Helpers ────────────────────────────────────────────────────────

const now = Date.now();

function createJob(
  organizationId: string,
  overrides?: Partial<Record<string, unknown>>
) {
  return {
    id: generateId(),
    organizationId,
    type: "system_check",
    status: "pending",
    progress: 0,
    metadata: {},
    result: null,
    error: null,
    startedAt: null,
    completedAt: null,
    bullJobId: null,
    attempts: 0,
    maxAttempts: 3,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Jobs Router — GET /api/jobs", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("should return an empty list when no jobs exist", async () => {
    await seedUserAndOrg(db as ReturnType<typeof drizzle>, AUTH0_ID);

    const res = await request(app)
      .get("/api/jobs")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payload.jobs).toEqual([]);
    expect(res.body.payload.total).toBe(0);
  });

  it("should filter by a single status", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );

    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values([
        createJob(organizationId, { status: "pending" }),
        createJob(organizationId, { status: "completed" }),
      ] as never);

    const res = await request(app)
      .get("/api/jobs?status=completed")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.payload.jobs).toHaveLength(1);
    expect(res.body.payload.jobs[0].status).toBe("completed");
  });

  it("should filter by multiple statuses (comma-separated)", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );

    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values([
        createJob(organizationId, { status: "pending" }),
        createJob(organizationId, { status: "completed" }),
        createJob(organizationId, { status: "failed" }),
      ] as never);

    const res = await request(app)
      .get("/api/jobs?status=completed,failed")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.payload.jobs).toHaveLength(2);
    const statuses = res.body.payload.jobs.map(
      (j: { status: string }) => j.status
    );
    expect(statuses).toContain("completed");
    expect(statuses).toContain("failed");
    expect(statuses).not.toContain("pending");
  });

  it("should filter by a single type", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );

    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values([
        createJob(organizationId, { type: "system_check" }),
        createJob(organizationId, { type: "revalidation" }),
      ] as never);

    const res = await request(app)
      .get("/api/jobs?type=revalidation")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.payload.jobs).toHaveLength(1);
    expect(res.body.payload.jobs[0].type).toBe("revalidation");
  });

  it("should filter by multiple types (comma-separated)", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );

    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values([
        createJob(organizationId, {
          type: "system_check",
          status: "completed",
        }),
        createJob(organizationId, { type: "revalidation", status: "pending" }),
      ] as never);

    const res = await request(app)
      .get("/api/jobs?type=system_check,revalidation")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.payload.jobs).toHaveLength(2);
    const types = res.body.payload.jobs.map((j: { type: string }) => j.type);
    expect(types).toContain("system_check");
    expect(types).toContain("revalidation");
  });

  it("should compose status and type filters", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );

    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values([
        createJob(organizationId, {
          type: "system_check",
          status: "completed",
        }),
        createJob(organizationId, { type: "revalidation", status: "completed" }),
        createJob(organizationId, { type: "system_check", status: "failed" }),
      ] as never);

    const res = await request(app)
      .get("/api/jobs?type=system_check&status=completed,failed")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.payload.jobs).toHaveLength(2);
    const jobs_ = res.body.payload.jobs as { type: string; status: string }[];
    expect(jobs_.every((j) => j.type === "system_check")).toBe(true);
    const statuses = jobs_.map((j) => j.status);
    expect(statuses).toContain("completed");
    expect(statuses).toContain("failed");
  });

  it("should scope results to the authenticated organization", async () => {
    const { organizationId } = await seedUserAndOrg(
      db as ReturnType<typeof drizzle>,
      AUTH0_ID
    );
    const otherOrgId = generateId();

    await (db as ReturnType<typeof drizzle>)
      .insert(jobs)
      .values([
        createJob(organizationId, { type: "system_check" }),
        createJob(otherOrgId, { type: "system_check" }),
      ] as never);

    const res = await request(app)
      .get("/api/jobs")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.payload.jobs).toHaveLength(1);
    expect(res.body.payload.jobs[0].organizationId).toBe(organizationId);
  });
});
