/**
 * Integration tests for the AuditLogRepository (#575, slice 2).
 *
 * `append` is the only write path; `findPage` is the org-scoped, filtered,
 * newest-first read; `deleteOlderThan` is the retention purge's batch seam
 * (which sets the `app.audit_retention_purge` flag so the append-only trigger
 * permits its DELETEs). The trigger-holds test proves the DB blocks every
 * other UPDATE/DELETE. Runs against the real DB harness (migrations applied).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";

import { AuditLogRepository } from "../../../../db/repositories/audit-log.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

/** audit_log's append-only trigger blocks plain DELETE — cleanup opts into the
 *  purge flag the same way `deleteOlderThan` does. */
async function purgeAuditLog(client: ReturnType<typeof drizzle>) {
  await client.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.audit_retention_purge = 'on'`);
    await tx.delete(schema.auditLog);
  });
}

describe("AuditLogRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: AuditLogRepository;
  let orgId: string;
  let otherOrgId: string;
  let userId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    repo = new AuditLogRepository();

    const client = db as ReturnType<typeof drizzle>;
    await purgeAuditLog(client);
    await teardownOrg(client);

    const user = createUser(`auth0|${generateId()}`);
    await client.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    const other = createOrganization(user.id, { name: "Other Org" });
    await client.insert(schema.organizations).values(org as never);
    await client.insert(schema.organizations).values(other as never);
    orgId = org.id;
    otherOrgId = other.id;
    userId = user.id;
  });

  afterEach(async () => {
    const client = db as ReturnType<typeof drizzle>;
    await purgeAuditLog(client);
    await teardownOrg(client);
    await connection.end();
  });

  function entry(overrides: Record<string, unknown> = {}) {
    return {
      id: generateId(),
      created: Date.now(),
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: orgId,
      userId,
      action: "org.delete",
      targetType: "organization",
      targetId: orgId,
      outcome: "success",
      sourceIp: "203.0.113.7",
      userAgent: "Mozilla/5.0",
      metadata: { confirmationName: "Acme" },
      ...overrides,
    };
  }

  it("append inserts a row that findPage returns", async () => {
    await repo.append(entry() as never);
    const { entries, total } = await repo.findPage(orgId, {
      limit: 20,
      offset: 0,
      sortBy: "created",
      sortOrder: "desc",
    });
    expect(total).toBe(1);
    expect(entries[0].action).toBe("org.delete");
  });

  it("findPage org-scopes — org A cannot see org B's rows", async () => {
    await repo.append(entry() as never);
    await repo.append(entry({ organizationId: otherOrgId }) as never);

    const a = await repo.findPage(orgId, {
      limit: 20,
      offset: 0,
      sortBy: "created",
      sortOrder: "desc",
    });
    expect(a.total).toBe(1);
    expect(a.entries[0].organizationId).toBe(orgId);
  });

  it("findPage filters by action and outcome", async () => {
    await repo.append(
      entry({ action: "org.delete", outcome: "success" }) as never
    );
    await repo.append(
      entry({ action: "toolpack.secret.rotate", outcome: "failure" }) as never
    );

    const byAction = await repo.findPage(orgId, {
      action: "toolpack.secret.rotate",
      limit: 20,
      offset: 0,
      sortBy: "created",
      sortOrder: "desc",
    });
    expect(byAction.total).toBe(1);
    expect(byAction.entries[0].action).toBe("toolpack.secret.rotate");

    const byOutcome = await repo.findPage(orgId, {
      outcome: "failure",
      limit: 20,
      offset: 0,
      sortBy: "created",
      sortOrder: "desc",
    });
    expect(byOutcome.total).toBe(1);
    expect(byOutcome.entries[0].outcome).toBe("failure");
  });

  it("findPage orders newest-first and paginates with a stable total", async () => {
    const now = Date.now();
    await repo.append(entry({ created: now - 2000 }) as never);
    await repo.append(entry({ created: now - 1000 }) as never);
    await repo.append(entry({ created: now }) as never);

    const page = await repo.findPage(orgId, {
      limit: 2,
      offset: 0,
      sortBy: "created",
      sortOrder: "desc",
    });
    expect(page.total).toBe(3);
    expect(page.entries).toHaveLength(2);
    expect(page.entries[0].created).toBe(now); // newest first
  });

  it("deleteOlderThan removes rows before the cutoff and keeps newer ones", async () => {
    const now = Date.now();
    await repo.append(entry({ created: now - 10_000 }) as never);
    await repo.append(entry({ created: now }) as never);

    const deleted = await repo.deleteOlderThan(now - 5_000, 1000);
    expect(deleted).toBe(1);

    const { total } = await repo.findPage(orgId, {
      limit: 20,
      offset: 0,
      sortBy: "created",
      sortOrder: "desc",
    });
    expect(total).toBe(1);
  });

  // ── Tamper-evidence: the append-only trigger ───────────────────────

  // drizzle wraps a Postgres error as `Failed query: …` and puts the original
  // (with the trigger's RAISE message) on `.cause`, so match against both.
  const triggerMessage = (err: unknown): string => {
    const e = err as { message?: string; cause?: { message?: string } };
    return `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  };

  it("blocks a plain UPDATE (the append-only trigger raises, row unchanged)", async () => {
    await repo.append(entry({ id: "audit-immutable" }) as never);
    const client = db as ReturnType<typeof drizzle>;

    let caught: unknown;
    try {
      await client
        .update(schema.auditLog)
        .set({ outcome: "failure" })
        .where(eq(schema.auditLog.id, "audit-immutable"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(triggerMessage(caught)).toMatch(/append-only/i);

    // The row is unchanged — the mutation was blocked, not merely errored.
    const rows = await client
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.id, "audit-immutable"));
    expect(rows[0].outcome).toBe("success");
  });

  it("blocks an unflagged DELETE but allows the purge-flagged DELETE", async () => {
    await repo.append(entry({ id: "audit-nodelete" }) as never);
    const client = db as ReturnType<typeof drizzle>;

    // Unflagged delete → blocked.
    let caught: unknown;
    try {
      await client
        .delete(schema.auditLog)
        .where(eq(schema.auditLog.id, "audit-nodelete"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(triggerMessage(caught)).toMatch(/append-only/i);

    // Still there — the delete was blocked.
    const before = await repo.findPage(orgId, {
      limit: 20,
      offset: 0,
      sortBy: "created",
      sortOrder: "desc",
    });
    expect(before.total).toBe(1);

    // Flagged delete (the purge path) → allowed.
    await client.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.audit_retention_purge = 'on'`);
      await tx
        .delete(schema.auditLog)
        .where(eq(schema.auditLog.id, "audit-nodelete"));
    });

    const after = await repo.findPage(orgId, {
      limit: 20,
      offset: 0,
      sortBy: "created",
      sortOrder: "desc",
    });
    expect(after.total).toBe(0);
  });
});
