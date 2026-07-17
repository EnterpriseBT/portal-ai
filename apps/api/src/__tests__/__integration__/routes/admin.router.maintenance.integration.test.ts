/**
 * Integration test for `GET /api/admin/maintenance` (#179 case 18b).
 *
 * BullMQ state is mocked (per spec) — the route's contract is the mapping
 * from queue state to the MaintenanceStatusResponse payload, not BullMQ's
 * scheduling behavior (covered by the purge processor suite).
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
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { generateId, teardownOrg } from "../utils/application.util.js";

const AUTH0_ID = "auth0|maintenance-admin";

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

// Mock BullMQ state: one registered scheduler + one completed purge run.
const mockGetJobSchedulers = jest.fn<() => Promise<unknown[]>>();
const mockGetJobs = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();

jest.unstable_mockModule("../../../queues/maintenance.queue.js", () => ({
  MAINTENANCE_QUEUE_NAME: "maintenance",
  LEDGER_RETENTION_PURGE_JOB: "ledger-retention-purge",
  maintenanceQueue: {
    getJobSchedulers: mockGetJobSchedulers,
    getJobs: mockGetJobs,
  },
  registerMaintenanceSchedulers: jest.fn(),
}));

const { app } = await import("../../../app.js");
const { ApplicationService } =
  await import("../../../services/application.service.js");

describe("GET /api/admin/maintenance (#179 case 18b)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);

    mockGetJobSchedulers.mockReset().mockResolvedValue([
      {
        key: "ledger-retention-purge",
        name: "ledger-retention-purge",
        pattern: "0 4 * * *",
        next: 1_790_000_000_000,
      },
    ]);
    mockGetJobs.mockReset().mockResolvedValue([
      {
        name: "ledger-retention-purge",
        finishedOn: 1_789_900_000_000,
        returnvalue: {
          purged: 120,
          batches: 1,
          cutoff: "2024-07-17T04:00:00.000Z",
        },
      },
    ]);
  });

  afterEach(async () => {
    await connection.end();
  });

  const seedCaller = async () => {
    const now = Date.now();
    const user = {
      id: generateId(),
      auth0Id: AUTH0_ID,
      email: `admin-${generateId()}@example.com`,
      name: "Admin",
      lastLogin: now,
      picture: null,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    };
    await ApplicationService.setupOrganization(user as never);
  };

  it("returns the scheduler entry + a completed run's summary", async () => {
    await seedCaller();

    const res = await request(app)
      .get("/api/admin/maintenance")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payload.schedulers).toEqual([
      {
        id: "ledger-retention-purge",
        pattern: "0 4 * * *",
        next: 1_790_000_000_000,
      },
    ]);
    expect(res.body.payload.recentRuns).toEqual([
      {
        name: "ledger-retention-purge",
        finishedOn: 1_789_900_000_000,
        returnvalue: {
          purged: 120,
          batches: 1,
          cutoff: "2024-07-17T04:00:00.000Z",
        },
      },
    ]);
  });

  it("surfaces a failed run's failedReason", async () => {
    await seedCaller();
    mockGetJobs.mockResolvedValue([
      {
        name: "ledger-retention-purge",
        finishedOn: 1_789_900_000_000,
        returnvalue: null,
        failedReason: "connection refused",
      },
    ]);

    const res = await request(app)
      .get("/api/admin/maintenance")
      .set("Authorization", "Bearer test-token");

    expect(res.status).toBe(200);
    expect(res.body.payload.recentRuns[0].failedReason).toBe(
      "connection refused"
    );
  });

  it("rejects anonymous callers", async () => {
    const res = await request(app).get("/api/admin/maintenance");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe(ApiCode.METADATA_MISSING_AUTH);
  });
});
