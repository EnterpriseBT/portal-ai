/**
 * Integration tests for the `db:demo:create` runner (#1035): argument
 * validation, the stderr id line, the one-line JSON report, and the
 * compensating soft delete when the dataset load fails after the org commits.
 *
 * The steps are injected (as `db:upgrade`'s are) so a failing load can be
 * simulated without a broken dataset; the success path runs the real seed
 * with a small `--rows`.
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

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  DEFAULT_DEMO_CREATE_STEPS,
  runDemoCreate,
  type DemoCreateSteps,
} from "../../../db/demo-create.js";
import { DEMO_MAX_ROWS } from "@portalai/core/contracts";
import { DbService } from "../../../services/db.service.js";
import { SeedService } from "../../../services/seed.service.js";
import { SystemUtilities } from "../../../utils/system.util.js";
import {
  createUser,
  generateId,
  teardownOrg,
} from "../utils/application.util.js";

describe("db:demo:create — runDemoCreate", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let ownerEmail!: string;
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
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await new SeedService().seedConnectorDefinitions(db);
    const owner = createUser(`auth0|${generateId()}`);
    await db.insert(schema.users).values(owner as never);
    ownerEmail = owner.email;
    out = [];
    err = [];
    delete process.env.DEMO_TOOLPACK_URL;
  });

  afterEach(async () => {
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await connection.end();
  });

  const args = (over: Record<string, string> = {}) => {
    const a = {
      "--name": `Demo ${generateId()}`,
      "--owner-email": ownerEmail,
      "--tier": "standard",
      "--rows": "20",
      ...over,
    };
    return Object.entries(a).flat();
  };

  it("creates and seeds, printing the org id to stderr and one JSON line", async () => {
    const code = await runDemoCreate(args(), DEFAULT_DEMO_CREATE_STEPS, io);

    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const report = JSON.parse(out[0]) as Record<string, unknown>;
    expect(report).toEqual(
      expect.objectContaining({
        organizationId: expect.any(String),
        stationId: expect.any(String),
        tier: "standard",
        rows: 20,
        entities: expect.any(Number),
        toolpacks: expect.objectContaining({ custom: null }),
        views: 11,
        durationMs: expect.any(Number),
      })
    );
    expect(err.join("\n")).toContain(
      `demo org ${report.organizationId as string} created`
    );
    const org = await DbService.repository.organizations.findById(
      report.organizationId as string
    );
    expect(org!.isDemo).toBe(true);
  }, 90000);

  it("deletes the org it created when the load fails, and exits 1", async () => {
    let createdId: string | undefined;
    const steps: DemoCreateSteps = {
      ...DEFAULT_DEMO_CREATE_STEPS,
      create: async (opts) => {
        const created = await DEFAULT_DEMO_CREATE_STEPS.create(opts);
        createdId = created.organizationId;
        return created;
      },
      seed: jest
        .fn<DemoCreateSteps["seed"]>()
        .mockRejectedValue(
          new Error("demo toolpack registration failed: boom")
        ),
    };

    const code = await runDemoCreate(args(), steps, io);

    expect(code).toBe(1);
    expect(out).toHaveLength(0);
    expect(createdId).toBeDefined();
    expect(
      await DbService.repository.organizations.findById(createdId!)
    ).toBeUndefined();
    const [row] = (await db.select().from(schema.organizations)).filter(
      (o) => o.id === createdId
    );
    expect(row.deleted).not.toBeNull();
    expect(row.deletedBy).toBe(SystemUtilities.id.system);
    // The full org deletion ran: the owner's membership went with it.
    const memberships = (
      await db.select().from(schema.organizationUsers)
    ).filter((m) => m.organizationId === createdId);
    expect(memberships.every((m) => m.deleted !== null)).toBe(true);
    expect(err.join("\n")).toContain(
      `demo create failed; org ${createdId!} deleted: demo toolpack registration failed: boom`
    );
  });

  it("names the org for `demo delete` when the cleanup itself fails", async () => {
    let createdId: string | undefined;
    const steps: DemoCreateSteps = {
      create: async (opts) => {
        const created = await DEFAULT_DEMO_CREATE_STEPS.create(opts);
        createdId = created.organizationId;
        return created;
      },
      seed: async () => {
        throw new Error("load failed");
      },
      discard: async () => {
        throw new Error("db gone");
      },
    };

    const code = await runDemoCreate(args(), steps, io);

    expect(code).toBe(1);
    expect(err.join("\n")).toContain(`run: portalai demo delete ${createdId!}`);
  });

  it("creates nothing when the create step throws (unknown owner)", async () => {
    const seed = jest.fn<DemoCreateSteps["seed"]>();
    const code = await runDemoCreate(
      args({ "--owner-email": `missing-${generateId()}@example.com` }),
      { ...DEFAULT_DEMO_CREATE_STEPS, seed },
      io
    );
    expect(code).toBe(1);
    expect(seed).not.toHaveBeenCalled();
    expect(err.join("\n")).toMatch(/not found/);
  });

  it.each([
    ["a missing --name", { "--name": "" }],
    ["a name over 120 characters", { "--name": "x".repeat(121) }],
    ["a line break in the name", { "--name": "Acme\nDemo" }],
    ["a non-integer --rows", { "--rows": "1.5" }],
    ["a negative --rows", { "--rows": "-1" }],
    ["--rows over the cap", { "--rows": String(DEMO_MAX_ROWS + 1) }],
  ])("refuses %s before creating anything", async (_label, over) => {
    const create = jest.fn<DemoCreateSteps["create"]>();
    const code = await runDemoCreate(
      args(over),
      { ...DEFAULT_DEMO_CREATE_STEPS, create },
      io
    );
    expect(code).toBe(1);
    expect(create).not.toHaveBeenCalled();
    expect(err.join("\n")).toMatch(/^Usage: db:demo:create/);
  });
});
