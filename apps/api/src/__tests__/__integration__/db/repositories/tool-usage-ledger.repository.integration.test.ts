/**
 * Integration tests for the ToolUsageLedgerRepository (#179, slice 1).
 *
 * `insertIfNew` is the append-only idempotency gate (FULL unique on
 * tool_call_id — the stripe_events pattern); `findPage` is the org-scoped
 * paginated read; `deleteOlderThan` is the retention purge's batch seam.
 * Runs against the real DB harness (migrations applied).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import { ToolUsageLedgerRepository } from "../../../../db/repositories/tool-usage-ledger.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("ToolUsageLedgerRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: ToolUsageLedgerRepository;
  let orgId: string;
  let otherOrgId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    repo = new ToolUsageLedgerRepository();

    const client = db as ReturnType<typeof drizzle>;
    await client.delete(schema.toolUsageLedger);
    await teardownOrg(client);

    const user = createUser(`auth0|${generateId()}`);
    await client.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    const other = createOrganization(user.id, { name: "Other Org" });
    await client.insert(schema.organizations).values(org as never);
    await client.insert(schema.organizations).values(other as never);
    orgId = org.id;
    otherOrgId = other.id;
  });

  afterEach(async () => {
    const client = db as ReturnType<typeof drizzle>;
    await client.delete(schema.toolUsageLedger);
    await teardownOrg(client);
    await connection.end();
  });

  function entry(overrides: Record<string, unknown> = {}) {
    return {
      id: generateId(),
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: orgId,
      toolName: "web_search",
      toolCallId: `call_${generateId()}`,
      stationId: "station-1",
      portalId: "portal-1",
      costClass: "metered",
      units: 1,
      periodId: "2026-07",
      userId: "user-1",
      ...overrides,
    };
  }

  async function rowsFor(toolCallId: string) {
    return (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.toolUsageLedger)
      .where(eq(schema.toolUsageLedger.toolCallId, toolCallId));
  }

  // ── case 3: idempotency ─────────────────────────────────────────────

  it("insertIfNew returns true for a new toolCallId, false on redelivery — one row", async () => {
    const toolCallId = `call_${generateId()}`;

    expect(await repo.insertIfNew(entry({ toolCallId }) as never, db)).toBe(
      true
    );
    expect(await repo.insertIfNew(entry({ toolCallId }) as never, db)).toBe(
      false
    );
    expect((await rowsFor(toolCallId)).length).toBe(1);
  });

  it("concurrent double-insert of the same toolCallId yields exactly one row", async () => {
    const toolCallId = `call_${generateId()}`;

    const [a, b] = await Promise.all([
      repo.insertIfNew(entry({ toolCallId }) as never, db),
      repo.insertIfNew(entry({ toolCallId }) as never, db),
    ]);

    expect([a, b].filter(Boolean).length).toBe(1);
    expect((await rowsFor(toolCallId)).length).toBe(1);
  });

  // ── case 4: findPage ────────────────────────────────────────────────

  it("findPage scopes to the org, filters, sorts, and totals independently of the page", async () => {
    const base = Date.now();
    // 3 rows this org (2 metered web_search in 2026-07, 1 expensive cluster in 2026-06)
    await repo.insertIfNew(
      entry({
        created: base - 3000,
        toolName: "web_search",
        units: 1,
      }) as never,
      db
    );
    await repo.insertIfNew(
      entry({
        created: base - 2000,
        toolName: "web_search",
        units: 5,
      }) as never,
      db
    );
    await repo.insertIfNew(
      entry({
        created: base - 1000,
        toolName: "cluster",
        costClass: "expensive",
        units: 3,
        periodId: "2026-06",
      }) as never,
      db
    );
    // 1 row another org — must never appear
    await repo.insertIfNew(
      entry({ organizationId: otherOrgId, toolName: "web_search" }) as never,
      db
    );

    // Org scoping + default sort (created desc)
    const all = await repo.findPage(
      orgId,
      { limit: 10, offset: 0, sortBy: "created", sortOrder: "desc" },
      db
    );
    expect(all.total).toBe(3);
    expect(all.entries.length).toBe(3);
    expect(all.entries[0].toolName).toBe("cluster"); // newest first
    expect(all.entries.every((e) => e.organizationId === orgId)).toBe(true);

    // Filters
    const july = await repo.findPage(
      orgId,
      {
        periodId: "2026-07",
        limit: 10,
        offset: 0,
        sortBy: "created",
        sortOrder: "desc",
      },
      db
    );
    expect(july.total).toBe(2);
    const cluster = await repo.findPage(
      orgId,
      {
        toolName: "cluster",
        limit: 10,
        offset: 0,
        sortBy: "created",
        sortOrder: "desc",
      },
      db
    );
    expect(cluster.total).toBe(1);

    // Pagination: total independent of the page slice
    const page = await repo.findPage(
      orgId,
      { limit: 1, offset: 1, sortBy: "units", sortOrder: "asc" },
      db
    );
    expect(page.total).toBe(3);
    expect(page.entries.length).toBe(1);
    expect(page.entries[0].units).toBe(3); // units asc: 1, 3, 5 → offset 1 = 3

    // Search: case-insensitive substring on toolName, org-scoped
    const searched = await repo.findPage(
      orgId,
      {
        search: "SEARCH",
        limit: 10,
        offset: 0,
        sortBy: "created",
        sortOrder: "desc",
      },
      db
    );
    expect(searched.total).toBe(2); // both web_search rows; other org's excluded
    expect(searched.entries.every((e) => e.toolName === "web_search")).toBe(
      true
    );
  });

  // ── case 5: deleteOlderThan ─────────────────────────────────────────

  it("deleteOlderThan removes only rows older than the cutoff, honoring batch size", async () => {
    const now = Date.now();
    const old1 = entry({ created: now - 10_000 });
    const old2 = entry({ created: now - 9_000 });
    const fresh = entry({ created: now });
    for (const row of [old1, old2, fresh]) {
      await repo.insertIfNew(row as never, db);
    }

    const cutoff = now - 5_000;

    // Batch of 1: two calls each delete one old row.
    expect(await repo.deleteOlderThan(cutoff, 1, db)).toBe(1);
    expect(await repo.deleteOlderThan(cutoff, 1, db)).toBe(1);
    expect(await repo.deleteOlderThan(cutoff, 1, db)).toBe(0); // drained

    const remaining = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.toolUsageLedger);
    expect(remaining.length).toBe(1);
    expect(remaining[0].toolCallId).toBe(fresh.toolCallId);
  });

  // ── case 6: schema probes ───────────────────────────────────────────

  it("CHECKs reject costClass 'free' and non-positive units", async () => {
    await expect(
      repo.insertIfNew(entry({ costClass: "free" }) as never, db)
    ).rejects.toThrow();
    await expect(
      repo.insertIfNew(entry({ units: 0 }) as never, db)
    ).rejects.toThrow();
  });
});
