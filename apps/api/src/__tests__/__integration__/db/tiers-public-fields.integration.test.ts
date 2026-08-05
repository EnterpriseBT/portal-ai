/**
 * Integration tests for the #311 marketing-site tier columns: `is_public`,
 * `display_order`, the `tiers_public_org_check` CHECK, and the anonymous-safe
 * `findPublic` finder. Runs against the real DB harness (migrations applied).
 * Mirrors the #241 card-fields suite's fixture pattern.
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

describe("tiers public fields integration (#311 slice 1)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: TiersRepository;
  const asRaw = () => db as ReturnType<typeof drizzle>;
  let orgA: string;
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
    await asRaw()
      .insert(schema.organizations)
      .values([a] as never);
    orgA = a.id;
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
      public: false,
      displayOrder: 0,
      description: null,
      visibleToOrganizationId: null,
      ...overrides,
    };
  }

  const insert = (row: Record<string, unknown>) =>
    asRaw()
      .insert(schema.tiers)
      .values(row as never);

  // ── spec §3 — findPublic returns only public rows, ordered ───────────
  it("findPublic returns only public rows ordered by displayOrder", async () => {
    const second = `pub-b-${generateId()}`;
    const first = `pub-a-${generateId()}`;
    const hidden = `hidden-${generateId()}`;
    // Insert out of order to prove the sort is displayOrder, not created.
    await insert(tierRow(second, { public: true, displayOrder: 20 }));
    await insert(tierRow(first, { public: true, displayOrder: 10 }));
    await insert(tierRow(hidden, { public: false, displayOrder: 5 }));

    const rows = await repo.findPublic(db);
    const slugs = rows.map((r) => r.slug);
    expect(slugs).not.toContain(hidden);
    const a = slugs.indexOf(first);
    const b = slugs.indexOf(second);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(b);
  });

  // ── spec §3 — soft-deleted public rows are excluded ──────────────────
  it("findPublic excludes soft-deleted public rows", async () => {
    const slug = `pub-del-${generateId()}`;
    await insert(tierRow(slug, { public: true, displayOrder: 30 }));
    await asRaw()
      .update(schema.tiers)
      .set({ deleted: Date.now() })
      .where(eq(schema.tiers.slug, slug));

    const rows = await repo.findPublic(db);
    expect(rows.some((r) => r.slug === slug)).toBe(false);
  });

  // ── multi-tenancy — an org-private tier is provably absent ───────────
  it("findPublic excludes org-scoped rows (the named private-tier test)", async () => {
    const slug = `acme-${generateId()}`;
    await insert(
      tierRow(slug, {
        public: false,
        visibleToOrganizationId: orgA,
        cta: "contact",
      })
    );

    const rows = await repo.findPublic(db);
    expect(rows.some((r) => r.slug === slug)).toBe(false);
    // The row exists and IS visible to its own org via the authed finder —
    // absence above is filtering, not a failed insert.
    const forOrg = await repo.findSelectableForOrg(orgA, db);
    expect(forOrg.some((r) => r.slug === slug)).toBe(true);
  });

  // ── spec §1 — the CHECK makes public ∧ org-private unrepresentable ───
  it("tiers_public_org_check rejects a public row scoped to an org", async () => {
    await expect(
      insert(
        tierRow(`bad-${generateId()}`, {
          public: true,
          visibleToOrganizationId: orgA,
        })
      )
    ).rejects.toThrow();
  });
});
