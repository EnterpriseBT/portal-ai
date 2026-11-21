/**
 * Integration tests for the `db:org:delete` runner (#1088): the spawn target
 * of `portalai org delete`, which runs the full organization deletion (#197)
 * rather than tombstoning the org row alone. The cascade itself is covered
 * table by table in organization-delete.service.integration.test.ts; this
 * holds the script's contract and the outcome #1088 is about.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { runOrgDelete } from "../../../db/org-delete.js";
import { ApplicationService } from "../../../services/application.service.js";
import { DbService } from "../../../services/db.service.js";
import { JobsService } from "../../../services/jobs.service.js";
import { S3Service } from "../../../services/s3.service.js";
import { ApiError } from "../../../services/http.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { teardownOrg } from "../utils/application.util.js";
import {
  seedPopulatedOrg,
  wideTableExists,
} from "../utils/seed-populated-org.util.js";

type Db = ReturnType<typeof drizzle>;

describe("db:org:delete — runOrgDelete", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;
  let out: string[];
  let err: string[];
  const io = {
    out: (line: string) => out.push(line),
    err: (line: string) => err.push(line),
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    // The populated org has a queued job; cancel it as a DB transition
    // rather than through BullMQ, and keep S3 out of it.
    jest
      .spyOn(JobsService, "cancel")
      .mockImplementation(async (jobId: string) => {
        await db
          .update(schema.jobs)
          .set({ status: "cancelled" })
          .where(eq(schema.jobs.id, jobId));
        return {} as never;
      });
    jest.spyOn(S3Service, "deleteObject").mockResolvedValue(undefined as never);
    out = [];
    err = [];
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await teardownOrg(db);
    await connection.end();
  });

  it("runs the full deletion as the actor: content gone, org and memberships tombstoned", async () => {
    const target = await seedPopulatedOrg(db, "target");

    const code = await runOrgDelete(
      ["--org", target.orgId, "--actor", "operator-1"],
      undefined,
      io
    );

    expect(err).toEqual([]);
    expect(code).toBe(0);
    expect(JSON.parse(out[0])).toEqual({ id: target.orgId, deleted: true });

    expect(
      await DbService.repository.organizations.findById(target.orgId)
    ).toBeUndefined();
    const memberships = await db
      .select()
      .from(schema.organizationUsers)
      .where(eq(schema.organizationUsers.organizationId, target.orgId));
    expect(memberships).toHaveLength(2);
    for (const m of memberships) {
      expect(m.deleted).not.toBeNull();
      expect(m.deletedBy).toBe("operator-1");
    }
    const entities = await db
      .select()
      .from(schema.connectorEntities)
      .where(eq(schema.connectorEntities.id, target.connectorEntityId));
    expect(entities).toHaveLength(0);
    expect(await wideTableExists(db, target.connectorEntityId)).toBe(false);
  });

  it("leaves no member resolving to the deleted org", async () => {
    const target = await seedPopulatedOrg(db, "target");

    await runOrgDelete(
      ["--org", target.orgId, "--actor", "operator-1"],
      undefined,
      io
    );

    for (const userId of [target.ownerUserId, target.memberUserId]) {
      expect(
        await ApplicationService.getCurrentOrganization(userId)
      ).toBeNull();
    }
  });

  it("refuses a missing org with exit 1 and touches nothing else", async () => {
    const control = await seedPopulatedOrg(db, "control");

    const code = await runOrgDelete(
      ["--org", "no-such-org", "--actor", "operator-1"],
      undefined,
      io
    );

    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/not found/);
    expect(
      await DbService.repository.organizations.findById(control.orgId)
    ).toBeDefined();
  });

  it("refuses an already-deleted org with exit 1", async () => {
    const target = await seedPopulatedOrg(db, "target");
    await runOrgDelete(
      ["--org", target.orgId, "--actor", "operator-1"],
      undefined,
      io
    );

    const code = await runOrgDelete(
      ["--org", target.orgId, "--actor", "operator-1"],
      undefined,
      io
    );

    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/not found/);
  });

  it("a job-lock refusal names each running job on stderr (#1088 review)", async () => {
    const refuse = async () => {
      throw new ApiError(
        409,
        ApiCode.ENTITY_LOCKED_BY_JOB,
        "Organization is locked by an in-flight job",
        {
          runningJobs: [
            { id: "j-1", type: "connector_sync", status: "active" },
            { id: "j-2", type: "revalidation", status: "active" },
          ],
        }
      );
    };

    const code = await runOrgDelete(
      ["--org", "o-1", "--actor", "operator-1"],
      refuse,
      io
    );

    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err).toEqual([
      "Organization is locked by an in-flight job:",
      "  connector_sync j-1 (active)",
      "  revalidation j-2 (active)",
    ]);
  });

  it.each([
    ["no --org", ["--actor", "operator-1"]],
    ["no --actor", ["--org", "o-1"]],
    ["--org's value is a flag", ["--org", "--actor", "operator-1"]],
    ["an unknown flag", ["--org", "o-1", "--actor", "a", "--force", "x"]],
  ])("is a usage error with %s", async (_label, argv) => {
    expect(await runOrgDelete(argv, undefined, io)).toBe(1);
    expect(err.join("\n")).toMatch(/^Usage: db:org:delete/);
  });
});
