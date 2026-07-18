/**
 * Integration tests for the #214 tier-entitlement schema surface (slice 1):
 *
 * - Fail-closed column defaults (a raw INSERT without the fields grants
 *   nothing).
 * - Migration/backfill probe: pre-existing rows (incl. `standard`) are
 *   fully permissive.
 * - The seed pin (#218-updated): `seedTiers` is bootstrap-only — an
 *   existing row is never written; convergence belongs to
 *   `portalops tier apply`.
 * - The OQ2 interim warn: `findUnlistedRegistrySlugs` reports registry
 *   slugs no live tier row lists.
 *
 * Runs against the real DB harness (migrations applied).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { BuiltinToolpackSlugSchema } from "@portalai/core/registries";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { SeedService } from "../../../services/seed.service.js";
import { generateId } from "../utils/application.util.js";

const ALL_SLUGS = [...BuiltinToolpackSlugSchema.options];

describe("Tier entitlements schema integration (#214 slice 1)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  const createdSlugs: string[] = [];

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
  });

  afterEach(async () => {
    for (const slug of createdSlugs) {
      await db.delete(schema.tiers).where(eq(schema.tiers.slug, slug));
    }
    createdSlugs.length = 0;
    // Restore the shared standard row to the permissive posture other
    // suites assume.
    await db
      .update(schema.tiers)
      .set({
        selectable: true,
        builtinToolpacks: ALL_SLUGS,
        customToolpacks: true,
      })
      .where(eq(schema.tiers.slug, "standard"));
    await connection.end();
  });

  function minimalTierRow(slug: string) {
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
      meteredUnitsPerPeriod: 100,
      meteredRatePerMin: 10,
      expensiveUnitsPerPeriod: 10,
      expensiveRatePerMin: 2,
      // deliberately NO builtinToolpacks / customToolpacks — defaults apply
    };
  }

  // ── case 16: fail-closed defaults ───────────────────────────────────

  it("a raw INSERT without entitlement fields grants nothing ([] / false)", async () => {
    const slug = `test-failclosed-${generateId().slice(0, 8)}`;
    await db.insert(schema.tiers).values(minimalTierRow(slug) as never);

    const [row] = await db
      .select()
      .from(schema.tiers)
      .where(eq(schema.tiers.slug, slug));

    expect(row.builtinToolpacks).toEqual([]);
    expect(row.customToolpacks).toBe(false);
  });

  // ── case 17: migration/backfill probe ───────────────────────────────

  it("pre-existing rows are fully permissive post-backfill (standard probe)", async () => {
    const [standard] = await db
      .select()
      .from(schema.tiers)
      .where(eq(schema.tiers.slug, "standard"));

    expect([...standard.builtinToolpacks].sort()).toEqual(
      [...ALL_SLUGS].sort()
    );
    expect(standard.customToolpacks).toBe(true);
  });

  // ── case 18: the OQ1 pin ────────────────────────────────────────────

  it("seedTiers is bootstrap-only: an existing row is never written (#218)", async () => {
    const seedService = new SeedService();

    // Drift EVERY formerly-converged class — policy, entitlements, and the
    // once seed-authoritative selectable. Nothing may heal: convergence is
    // `portalops tier apply`'s job now (#218).
    await db
      .update(schema.tiers)
      .set({
        builtinToolpacks: ["web_search"],
        customToolpacks: false,
        selectable: false,
      })
      .where(eq(schema.tiers.slug, "standard"));

    await seedService.seedTiers(db as unknown as DbClient);
    await seedService.seedTiers(db as unknown as DbClient); // idempotent

    const [standard] = await db
      .select()
      .from(schema.tiers)
      .where(eq(schema.tiers.slug, "standard"));

    expect(standard.builtinToolpacks).toEqual(["web_search"]);
    expect(standard.customToolpacks).toBe(false);
    expect(standard.selectable).toBe(false); // no longer healed by seed
    expect(standard.updated).toBeNull(); // literally no write happened
  });

  // ── case 19: the OQ2 interim warn helper ────────────────────────────

  it("findUnlistedRegistrySlugs reports slugs no live tier lists, and is silent when covered", async () => {
    const seedService = new SeedService();

    // Every registry slug is on the permissive standard row → nothing unlisted.
    expect(
      await SeedService.findUnlistedRegistrySlugs(db as unknown as DbClient)
    ).toEqual([]);

    // Tighten every live row's allowlist below the registry.
    await db.update(schema.tiers).set({ builtinToolpacks: ["web_search"] });

    const unlisted = await SeedService.findUnlistedRegistrySlugs(
      db as unknown as DbClient
    );
    expect(unlisted.sort()).toEqual(
      ALL_SLUGS.filter((s) => s !== "web_search").sort()
    );

    // seedTiers itself must not throw in that state (it warns).
    await expect(
      seedService.seedTiers(db as unknown as DbClient)
    ).resolves.toBeUndefined();
  });
});
