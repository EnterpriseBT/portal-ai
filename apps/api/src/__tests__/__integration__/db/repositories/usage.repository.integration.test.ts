/**
 * Integration tests for the UsageRepository (#172, slice 3).
 *
 * Exercises the atomic increment seam (#169 will call it) and the
 * period-scoped read, against the real DB harness (migrations applied).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { UsageRepository } from "../../../../db/repositories/usage.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("UsageRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: UsageRepository;
  let orgId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new UsageRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    const org = createOrganization(user.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;
  });

  afterEach(async () => {
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await connection.end();
  });

  function usageRow(overrides: Record<string, unknown> = {}) {
    return {
      id: generateId(),
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: orgId,
      periodId: "2026-07",
      costClass: "metered",
      unitsUsed: 0,
      ...overrides,
    };
  }

  // ── case 12 ─────────────────────────────────────────────────────────
  it("increment inserts, then accumulates on the same (org,period,class)", async () => {
    await repo.increment(usageRow({ unitsUsed: 10 }) as never, db);
    await repo.increment(usageRow({ unitsUsed: 5 }) as never, db);

    const rows = await repo.findForPeriod(orgId, "2026-07", db);
    expect(rows.length).toBe(1);
    expect(rows[0].unitsUsed).toBe(15);
  });

  // ── case 13 ─────────────────────────────────────────────────────────
  it("accumulates correctly across multiple increments (no lost update)", async () => {
    await Promise.all([
      repo.increment(usageRow({ unitsUsed: 3 }) as never, db),
      repo.increment(usageRow({ unitsUsed: 4 }) as never, db),
      repo.increment(usageRow({ unitsUsed: 5 }) as never, db),
    ]);

    const rows = await repo.findForPeriod(orgId, "2026-07", db);
    expect(rows.length).toBe(1);
    expect(rows[0].unitsUsed).toBe(12);
  });

  // ── case 14 ─────────────────────────────────────────────────────────
  it("the unique index rejects a duplicate live (org,period,class)", async () => {
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.usage)
      .values(usageRow({ unitsUsed: 1 }) as never);

    await expect(
      (db as ReturnType<typeof drizzle>)
        .insert(schema.usage)
        .values(usageRow({ id: generateId(), unitsUsed: 1 }) as never)
    ).rejects.toThrow();
  });

  // ── case 15 ─────────────────────────────────────────────────────────
  it("findForPeriod scopes to org + period", async () => {
    await repo.increment(usageRow({ periodId: "2026-07", unitsUsed: 1 }) as never, db);
    await repo.increment(usageRow({ periodId: "2026-08", unitsUsed: 1 }) as never, db);

    const rows = await repo.findForPeriod(orgId, "2026-07", db);
    expect(rows.length).toBe(1);
    expect(rows[0].periodId).toBe("2026-07");
  });
});
