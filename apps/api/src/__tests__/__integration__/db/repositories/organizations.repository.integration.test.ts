/**
 * Integration tests for the marketplace-entitlement surface on
 * OrganizationsRepository (#568, slice 2).
 *
 * Covers the UNIQUE-where-not-null constraint on `marketplace_entitlement_id`
 * (the #230-analog "one org tracks one entitlement" guard) and the
 * `findByMarketplaceEntitlementId` finder (soft-delete aware).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { OrganizationsRepository } from "../../../../db/repositories/organizations.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("OrganizationsRepository — marketplace entitlement (#568)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: OrganizationsRepository;
  let ownerUserId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    repo = new OrganizationsRepository();

    const client = db as ReturnType<typeof drizzle>;
    await teardownOrg(client);

    const user = createUser(`auth0|${generateId()}`);
    await client.insert(schema.users).values(user as never);
    ownerUserId = user.id;
  });

  afterEach(async () => {
    await teardownOrg(db as ReturnType<typeof drizzle>);
    await connection.end();
  });

  async function insertOrg(overrides: Record<string, unknown> = {}) {
    const org = createOrganization(ownerUserId, overrides);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    return org;
  }

  // ── case 6 — UNIQUE where not null ──────────────────────────────────

  it("rejects a duplicate non-null marketplace_entitlement_id", async () => {
    await insertOrg({ marketplaceEntitlementId: "aws-ent-dup" });
    await expect(
      insertOrg({ marketplaceEntitlementId: "aws-ent-dup" })
    ).rejects.toThrow();
  });

  it("allows multiple orgs with a null marketplace_entitlement_id", async () => {
    await insertOrg({ marketplaceEntitlementId: null });
    await expect(
      insertOrg({ marketplaceEntitlementId: null })
    ).resolves.toBeDefined();
  });

  // ── case 7 — findByMarketplaceEntitlementId ─────────────────────────

  it("finds an org by its marketplace entitlement id", async () => {
    const org = await insertOrg({
      marketplaceEntitlementId: "aws-ent-find",
      entitlementThrough: 1_900_000_000_000,
    });
    const found = await repo.findByMarketplaceEntitlementId(
      "aws-ent-find",
      db
    );
    expect(found?.id).toBe(org.id);
    expect(found?.entitlementThrough).toBe(1_900_000_000_000);
  });

  it("excludes a soft-deleted org", async () => {
    await insertOrg({
      marketplaceEntitlementId: "aws-ent-gone",
      deleted: Date.now(),
      deletedBy: "SYSTEM_TEST",
    });
    const found = await repo.findByMarketplaceEntitlementId("aws-ent-gone", db);
    expect(found).toBeUndefined();
  });
});
