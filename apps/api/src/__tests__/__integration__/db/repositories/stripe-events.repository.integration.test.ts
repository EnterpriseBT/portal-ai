/**
 * Integration tests for the StripeEventsRepository (#176, slice 1).
 *
 * `insertIfNew` is the atomic webhook dedup gate (D2): INSERT … ON CONFLICT
 * (event_id) DO NOTHING. Exercised against the real DB harness, including a
 * concurrent double-insert (two connections racing the same event id).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import { StripeEventsRepository } from "../../../../db/repositories/stripe-events.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("StripeEventsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: StripeEventsRepository;
  let orgId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    repo = new StripeEventsRepository();

    const client = db as ReturnType<typeof drizzle>;
    await client.delete(schema.stripeEvents);
    await teardownOrg(client);

    const user = createUser(`auth0|${generateId()}`);
    await client.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    await client.insert(schema.organizations).values(org as never);
    orgId = org.id;
  });

  afterEach(async () => {
    const client = db as ReturnType<typeof drizzle>;
    await client.delete(schema.stripeEvents);
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
      eventId: `evt_${generateId()}`,
      type: "customer.subscription.updated",
      stripeCustomerId: "cus_test",
      stripeSubscriptionId: "sub_test",
      organizationId: orgId,
      resultingTier: "pro",
      outcome: "applied",
      ...overrides,
    };
  }

  // ── case 8 ──────────────────────────────────────────────────────────

  it("insertIfNew returns true for a new event id, false on redelivery", async () => {
    const eventId = `evt_${generateId()}`;

    const first = await repo.insertIfNew(eventRow({ eventId }) as never, db);
    const second = await repo.insertIfNew(eventRow({ eventId }) as never, db);

    expect(first).toBe(true);
    expect(second).toBe(false);

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.stripeEvents)
      .where(eq(schema.stripeEvents.eventId, eventId));
    expect(rows.length).toBe(1);
  });

  it("concurrent double-insert of the same event id yields exactly one row", async () => {
    const eventId = `evt_${generateId()}`;

    const [a, b] = await Promise.all([
      repo.insertIfNew(eventRow({ eventId }) as never, db),
      repo.insertIfNew(eventRow({ eventId }) as never, db),
    ]);

    // Exactly one racer wins.
    expect([a, b].filter(Boolean).length).toBe(1);

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.stripeEvents)
      .where(eq(schema.stripeEvents.eventId, eventId));
    expect(rows.length).toBe(1);
  });

  it("outcome CHECK rejects an unknown outcome", async () => {
    await expect(
      repo.insertIfNew(eventRow({ outcome: "exploded" }) as never, db)
    ).rejects.toThrow();
  });

  it("accepts an unmatched event with null org linkage", async () => {
    const eventId = `evt_${generateId()}`;
    const inserted = await repo.insertIfNew(
      eventRow({
        eventId,
        organizationId: null,
        resultingTier: null,
        outcome: "unmatched",
      }) as never,
      db
    );
    expect(inserted).toBe(true);
  });
});
