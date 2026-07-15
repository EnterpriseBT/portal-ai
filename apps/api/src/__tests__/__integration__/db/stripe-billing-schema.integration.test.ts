/**
 * Integration tests for the #176 Stripe billing schema surface (slice 1):
 *
 * - `tiers.stripe_price_id` UNIQUE — rejects duplicates, allows multiple
 *   NULLs (PG UNIQUE ignores NULLs).
 * - `organizations` Stripe linkage UNIQUEs + the anchor-day CHECK.
 * - Migration/seed probe: new columns live, existing orgs stay
 *   calendar-month/unsubscribed, `standard` converges to `selectable = true`,
 *   seed is idempotent.
 *
 * Runs against the real DB harness (migrations applied).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { SeedService } from "../../../services/seed.service.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

describe("Stripe billing schema integration (#176 slice 1)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let userId: string;
  const createdTierSlugs: string[] = [];

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db);

    const user = createUser(`auth0|${generateId()}`);
    await db.insert(schema.users).values(user as never);
    userId = user.id;
  });

  afterEach(async () => {
    await teardownOrg(db);
    for (const slug of createdTierSlugs) {
      await db.delete(schema.tiers).where(eq(schema.tiers.slug, slug));
    }
    createdTierSlugs.length = 0;
    await connection.end();
  });

  function tierRow(slug: string, overrides: Record<string, unknown> = {}) {
    if (!createdTierSlugs.includes(slug)) createdTierSlugs.push(slug);
    return {
      id: generateId(),
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      slug,
      displayName: slug,
      periodKind: "monthly",
      periodAnchorDay: 1,
      overage: "hard-deny",
      freeUnitsPerPeriod: null,
      freeRatePerMin: null,
      meteredUnitsPerPeriod: 100,
      meteredRatePerMin: 10,
      expensiveUnitsPerPeriod: 10,
      expensiveRatePerMin: 2,
      perToolCaps: null,
      stripePriceId: null,
      selectable: false,
      ...overrides,
    };
  }

  // ── case 6 ──────────────────────────────────────────────────────────

  it("tiers.stripe_price_id UNIQUE allows multiple NULLs", async () => {
    await db
      .insert(schema.tiers)
      .values(tierRow(`test-a-${generateId()}`) as never);
    await expect(
      db.insert(schema.tiers).values(tierRow(`test-b-${generateId()}`) as never)
    ).resolves.not.toThrow();
  });

  it("tiers.stripe_price_id UNIQUE rejects a duplicate price id", async () => {
    const priceId = `price_${generateId()}`;
    await db
      .insert(schema.tiers)
      .values(
        tierRow(`test-a-${generateId()}`, { stripePriceId: priceId }) as never
      );
    await expect(
      db
        .insert(schema.tiers)
        .values(
          tierRow(`test-b-${generateId()}`, { stripePriceId: priceId }) as never
        )
    ).rejects.toThrow();
  });

  // ── case 7 ──────────────────────────────────────────────────────────

  it("organizations.stripe_customer_id UNIQUE rejects a duplicate", async () => {
    const customerId = `cus_${generateId()}`;
    await db
      .insert(schema.organizations)
      .values(
        createOrganization(userId, { stripeCustomerId: customerId }) as never
      );
    await expect(
      db
        .insert(schema.organizations)
        .values(
          createOrganization(userId, { stripeCustomerId: customerId }) as never
        )
    ).rejects.toThrow();
  });

  it("organizations.stripe_subscription_id UNIQUE rejects a duplicate", async () => {
    const subscriptionId = `sub_${generateId()}`;
    await db.insert(schema.organizations).values(
      createOrganization(userId, {
        stripeSubscriptionId: subscriptionId,
      }) as never
    );
    await expect(
      db.insert(schema.organizations).values(
        createOrganization(userId, {
          stripeSubscriptionId: subscriptionId,
        }) as never
      )
    ).rejects.toThrow();
  });

  it("organizations anchor CHECK rejects 0 and 29, accepts 1..28 and NULL", async () => {
    await expect(
      db
        .insert(schema.organizations)
        .values(createOrganization(userId, { billingAnchorDay: 0 }) as never)
    ).rejects.toThrow();
    await expect(
      db
        .insert(schema.organizations)
        .values(createOrganization(userId, { billingAnchorDay: 29 }) as never)
    ).rejects.toThrow();
    await expect(
      db
        .insert(schema.organizations)
        .values(createOrganization(userId, { billingAnchorDay: 15 }) as never)
    ).resolves.not.toThrow();
    await expect(
      db
        .insert(schema.organizations)
        .values(createOrganization(userId) as never)
    ).resolves.not.toThrow();
  });

  // ── case 34 (migration/seed probe) ──────────────────────────────────

  it("an org inserted without Stripe fields stays unsubscribed/calendar-month", async () => {
    const org = createOrganization(userId);
    await db.insert(schema.organizations).values(org as never);

    const [row] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, org.id));

    // Same defaults the migration leaves on pre-existing rows.
    expect(row.stripeCustomerId).toBeNull();
    expect(row.stripeSubscriptionId).toBeNull();
    expect(row.billingAnchorDay).toBeNull();
  });

  it("seedTiers converges `standard` to selectable = true and stays idempotent", async () => {
    const seedService = new SeedService();

    // Regardless of the row's pre-test state (fresh backfill or a stale
    // pre-#176 row), the seed must converge it.
    await db
      .update(schema.tiers)
      .set({ selectable: false })
      .where(eq(schema.tiers.slug, "standard"));

    await seedService.seedTiers(db as unknown as DbClient);
    // Idempotent — second run must not throw/duplicate.
    await seedService.seedTiers(db as unknown as DbClient);

    const rows = await db
      .select()
      .from(schema.tiers)
      .where(eq(schema.tiers.slug, "standard"));

    expect(rows.length).toBe(1);
    expect(rows[0].selectable).toBe(true);
    expect(rows[0].stripePriceId).toBeNull();
  });
});
