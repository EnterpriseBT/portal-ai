/**
 * Integration tests for the #241 tier card columns: `cta`, `description`,
 * `visible_to_organization_id`, the org-scoped finder, and the two new
 * CHECK/FK constraints. Runs against the real DB harness (migrations applied).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, inArray } from "drizzle-orm";

import { TiersRepository } from "../../../db/repositories/tiers.repository.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

describe("tiers card fields integration (#241 slice 1)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: TiersRepository;
  const asRaw = () => db as ReturnType<typeof drizzle>;
  let orgA: string;
  let orgB: string;
  const createdSlugs: string[] = [];

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new TiersRepository();

    await teardownOrg(asRaw());
    const user = createUser(`auth0|${generateId()}`);
    await asRaw()
      .insert(schema.users)
      .values(user as never);
    const a = createOrganization(user.id);
    const b = createOrganization(user.id);
    await asRaw()
      .insert(schema.organizations)
      .values([a, b] as never);
    orgA = a.id;
    orgB = b.id;
  });

  afterEach(async () => {
    if (createdSlugs.length > 0) {
      await asRaw()
        .delete(schema.tiers)
        .where(inArray(schema.tiers.slug, createdSlugs));
      createdSlugs.length = 0;
    }
    await teardownOrg(asRaw());
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
      meteredUnitsPerPeriod: null,
      meteredRatePerMin: null,
      expensiveUnitsPerPeriod: null,
      expensiveRatePerMin: null,
      perToolCaps: null,
      stripePriceId: null,
      selectable: true,
      builtinToolpacks: [],
      customToolpacks: false,
      cta: "none",
      description: null,
      visibleToOrganizationId: null,
      ...overrides,
    };
  }

  const insert = (row: Record<string, unknown>) =>
    asRaw()
      .insert(schema.tiers)
      .values(row as never);

  // ── case 6 ──────────────────────────────────────────────────────────
  it("findSelectableForOrg returns public rows (visible_to_organization_id IS NULL)", async () => {
    const slug = `pub-${generateId()}`;
    await insert(
      tierRow(slug, {
        cta: "subscribe",
        stripePriceId: `price_${generateId()}`,
      })
    );

    const rows = await repo.findSelectableForOrg(orgA, db);
    const found = rows.find((r) => r.slug === slug);
    expect(found).toBeDefined();
    expect(found?.cta).toBe("subscribe");
  });

  // ── case 7 (multi-tenant isolation) ─────────────────────────────────
  it("a tier scoped to org A is returned for A and excluded for B", async () => {
    const slug = `acme-${generateId()}`;
    await insert(
      tierRow(slug, {
        cta: "contact",
        visibleToOrganizationId: orgA,
        description: "Tailored.",
      })
    );

    const forA = await repo.findSelectableForOrg(orgA, db);
    const forB = await repo.findSelectableForOrg(orgB, db);
    expect(forA.some((r) => r.slug === slug)).toBe(true);
    expect(forB.some((r) => r.slug === slug)).toBe(false);
  });

  // ── case 8 (CHECKs) ─────────────────────────────────────────────────
  it("tiers_cta_check rejects an unknown cta", async () => {
    await expect(
      insert(tierRow(`bad-${generateId()}`, { cta: "buy-now" }))
    ).rejects.toThrow();
  });

  it("tiers_cta_price_check rejects cta='subscribe' with no price and accepts it with one", async () => {
    await expect(
      insert(
        tierRow(`np-${generateId()}`, { cta: "subscribe", stripePriceId: null })
      )
    ).rejects.toThrow();

    const ok = `p-${generateId()}`;
    await expect(
      insert(
        tierRow(ok, {
          cta: "subscribe",
          stripePriceId: `price_${generateId()}`,
        })
      )
    ).resolves.toBeDefined();
  });

  // ── case 9 (FK) ─────────────────────────────────────────────────────
  it("visible_to_organization_id FK rejects a nonexistent org", async () => {
    await expect(
      insert(
        tierRow(`fk-${generateId()}`, {
          visibleToOrganizationId: "org_does_not_exist",
        })
      )
    ).rejects.toThrow();
  });
});
