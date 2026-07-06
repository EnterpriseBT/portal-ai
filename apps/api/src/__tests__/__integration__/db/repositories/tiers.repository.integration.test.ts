/**
 * Integration tests for the TiersRepository (#172, slice 1).
 *
 * Runs against a real PostgreSQL database spun up by the integration-test
 * setup (migrations applied, so the `standard` tier row seeded by
 * `0065_create_tiers` is present). Mirrors the connection/teardown pattern
 * used by the other repository integration tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import { TiersRepository } from "../../../../db/repositories/tiers.repository.js";
import { SeedService } from "../../../../services/seed.service.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import { generateId } from "../../utils/application.util.js";

describe("TiersRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: TiersRepository;
  const createdSlugs: string[] = [];

  beforeEach(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new TiersRepository();
  });

  afterEach(async () => {
    // Remove only the rows this suite created; leave the seeded `standard`.
    for (const slug of createdSlugs) {
      await (db as ReturnType<typeof drizzle>)
        .delete(schema.tiers)
        .where(eq(schema.tiers.slug, slug));
    }
    createdSlugs.length = 0;
    await connection.end();
  });

  function tierRow(slug: string, overrides: Record<string, unknown> = {}) {
    if (!createdSlugs.includes(slug)) createdSlugs.push(slug);
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
      ...overrides,
    };
  }

  const insert = (row: Record<string, unknown>) =>
    (db as ReturnType<typeof drizzle>)
      .insert(schema.tiers)
      .values(row as never);

  // ── case 9 ──────────────────────────────────────────────────────────
  it("insert + findBySlug round-trips; soft-deleted rows excluded", async () => {
    const slug = `test-${generateId()}`;
    await insert(tierRow(slug));

    const found = await repo.findBySlug(slug, db);
    expect(found?.slug).toBe(slug);
    expect(found?.meteredUnitsPerPeriod).toBe(100);

    await (db as ReturnType<typeof drizzle>)
      .update(schema.tiers)
      .set({ deleted: Date.now() })
      .where(eq(schema.tiers.slug, slug));

    expect(await repo.findBySlug(slug, db)).toBeUndefined();
  });

  // ── case 10 ─────────────────────────────────────────────────────────
  it("slug UNIQUE rejects a duplicate even after soft-delete (full, non-partial)", async () => {
    const slug = `test-${generateId()}`;
    await insert(tierRow(slug));
    await (db as ReturnType<typeof drizzle>)
      .update(schema.tiers)
      .set({ deleted: Date.now() })
      .where(eq(schema.tiers.slug, slug));

    // A soft-delete-partial index would allow this; the full constraint rejects it.
    await expect(insert(tierRow(slug, { id: generateId() }))).rejects.toThrow();
  });

  // ── case 11 ─────────────────────────────────────────────────────────
  it("CHECK constraints reject invalid rows", async () => {
    await expect(
      insert(tierRow(`test-${generateId()}`, { overage: "explode" }))
    ).rejects.toThrow();
    await expect(
      insert(tierRow(`test-${generateId()}`, { periodAnchorDay: 40 }))
    ).rejects.toThrow();
    await expect(
      insert(tierRow(`test-${generateId()}`, { meteredUnitsPerPeriod: -5 }))
    ).rejects.toThrow();
  });

  // ── case 33 (tiers) ─────────────────────────────────────────────────
  it("the default `standard` tier is seeded by the migration", async () => {
    const found = await repo.findBySlug("standard", db);
    expect(found).toBeDefined();
    expect(found?.meteredUnitsPerPeriod).toBe(1000);
    expect(found?.freeUnitsPerPeriod).toBeNull();
  });

  // ── case 35 ─────────────────────────────────────────────────────────
  it("seedTiers is idempotent — running it does not duplicate `standard`", async () => {
    const seed = new SeedService();
    await seed.seedTiers(db);
    await seed.seedTiers(db);

    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.tiers)
      .where(eq(schema.tiers.slug, "standard"));
    expect(rows.length).toBe(1);
  });
});
