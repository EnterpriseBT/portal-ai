/**
 * Integration tests for the CommercialEventsRepository (#176, generalized #568).
 *
 * `insertIfNew` is the atomic webhook dedup gate (D2): INSERT … ON CONFLICT
 * (source, external_id) DO NOTHING. Exercised against the real DB harness,
 * including a concurrent double-insert (two connections racing the same
 * (source, external_id) pair) and the cross-source distinctness of the arbiter.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";

import { CommercialEventsRepository } from "../../../../db/repositories/commercial-events.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("CommercialEventsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: CommercialEventsRepository;
  let orgId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    repo = new CommercialEventsRepository();

    const client = db as ReturnType<typeof drizzle>;
    await client.delete(schema.commercialEvents);
    await teardownOrg(client);

    const user = createUser(`auth0|${generateId()}`);
    await client.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    await client.insert(schema.organizations).values(org as never);
    orgId = org.id;
  });

  afterEach(async () => {
    const client = db as ReturnType<typeof drizzle>;
    await client.delete(schema.commercialEvents);
    await teardownOrg(client);
    await connection.end();
  });

  function eventRow(overrides: Record<string, unknown> = {}) {
    return {
      id: generateId(),
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      source: "stripe",
      externalId: `evt_${generateId()}`,
      type: "customer.subscription.updated",
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test",
      organizationId: orgId,
      resultingTier: "pro",
      outcome: "applied",
      ...overrides,
    };
  }

  // ── case 4 — dedup on redelivery ────────────────────────────────────

  it("insertIfNew returns true for a new (source, external_id), false on redelivery", async () => {
    const externalId = `evt_${generateId()}`;

    const first = await repo.insertIfNew(eventRow({ externalId }) as never, db);
    const second = await repo.insertIfNew(eventRow({ externalId }) as never, db);

    expect(first).toBe(true);
    expect(second).toBe(false);

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.commercialEvents)
      .where(eq(schema.commercialEvents.externalId, externalId));
    expect(rows.length).toBe(1);
  });

  // ── case 3 — the arbiter is the (source, external_id) PAIR ───────────

  it("the same external_id under a different source is a distinct row", async () => {
    const externalId = `id_${generateId()}`;

    const a = await repo.insertIfNew(
      eventRow({ source: "stripe", externalId }) as never,
      db
    );
    const b = await repo.insertIfNew(
      eventRow({
        source: "aws_marketplace",
        externalId,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        resultingTier: "enterprise",
      }) as never,
      db
    );

    expect(a).toBe(true);
    expect(b).toBe(true); // different source ⇒ not a conflict

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.commercialEvents)
      .where(eq(schema.commercialEvents.externalId, externalId));
    expect(rows.length).toBe(2);

    // and the same (source, external_id) DOES conflict
    const dup = await repo.insertIfNew(
      eventRow({ source: "aws_marketplace", externalId }) as never,
      db
    );
    expect(dup).toBe(false);
  });

  it("concurrent double-insert of the same (source, external_id) yields exactly one row", async () => {
    const externalId = `evt_${generateId()}`;

    const [a, b] = await Promise.all([
      repo.insertIfNew(eventRow({ externalId }) as never, db),
      repo.insertIfNew(eventRow({ externalId }) as never, db),
    ]);

    expect([a, b].filter(Boolean).length).toBe(1);

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.commercialEvents)
      .where(
        and(
          eq(schema.commercialEvents.source, "stripe"),
          eq(schema.commercialEvents.externalId, externalId)
        )
      );
    expect(rows.length).toBe(1);
  });

  it("source CHECK rejects an unknown source", async () => {
    await expect(
      repo.insertIfNew(eventRow({ source: "gcp" }) as never, db)
    ).rejects.toThrow();
  });

  it("outcome CHECK rejects an unknown outcome", async () => {
    await expect(
      repo.insertIfNew(eventRow({ outcome: "exploded" }) as never, db)
    ).rejects.toThrow();
  });

  it("accepts a foreign-subscription row (#230)", async () => {
    const inserted = await repo.insertIfNew(
      eventRow({
        externalId: `evt_${generateId()}`,
        stripeSubscriptionId: "sub_orphan",
        resultingTier: null,
        outcome: "foreign",
      }) as never,
      db
    );
    expect(inserted).toBe(true);
  });

  it("accepts an unmatched event with null org linkage", async () => {
    const inserted = await repo.insertIfNew(
      eventRow({
        externalId: `evt_${generateId()}`,
        organizationId: null,
        resultingTier: null,
        outcome: "unmatched",
      }) as never,
      db
    );
    expect(inserted).toBe(true);
  });
});
