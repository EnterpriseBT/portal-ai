/**
 * #1071 (adversarial walk): migration 0141 makes tag names unique per org
 * among live tags. Duplicates the old check-then-insert let through would make
 * the index fail, so the migration first renames every duplicate but each
 * name's oldest live tag.
 *
 * The global setup already applied 0141, so each case drops the index, seeds
 * the duplicates it forbids, and re-runs the migration's SQL the way
 * db-migrate does. afterEach puts the index back whatever happened.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import {
  seedTenancyFixture,
  teardownOrg,
  generateId,
  type TenancyFixture,
} from "../utils/application.util.js";

const MIGRATION = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../drizzle/0141_unique-entity-tag-name.sql"
  ),
  "utf8"
);
const STATEMENTS = MIGRATION.split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

const INDEX =
  'CREATE UNIQUE INDEX IF NOT EXISTS "entity_tags_org_name_unique" ON "entity_tags" USING btree ("organization_id","name") WHERE deleted IS NULL';

describe("0141 unique-entity-tag-name (#1071)", () => {
  let connection!: ReturnType<typeof postgres>;
  let d!: ReturnType<typeof drizzle>;
  let fx!: TenancyFixture;

  async function runMigration() {
    await connection.begin(async (tx) => {
      for (const stmt of STATEMENTS) await tx.unsafe(stmt);
    });
  }

  /** A tag row, `created` fixed so the oldest is known. */
  async function tag(
    orgId: string,
    name: string,
    created: number,
    deleted: number | null = null
  ): Promise<string> {
    const id = generateId();
    await d.insert(schema.entityTags).values({
      id,
      organizationId: orgId,
      name,
      color: null,
      description: null,
      sourcePortalId: null,
      created,
      createdBy: fx.ownerId,
      updated: null,
      updatedBy: null,
      deleted,
      deletedBy: deleted ? fx.ownerId : null,
    } as never);
    return id;
  }

  async function nameOf(id: string): Promise<string> {
    const [row] =
      await connection`SELECT name FROM entity_tags WHERE id = ${id}`;
    return row.name as string;
  }

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    d = drizzle(connection, { schema });
    await teardownOrg(d);
    fx = await seedTenancyFixture(d, {
      owner: `auth0|m0141-owner-${generateId()}`,
      member: `auth0|m0141-member-${generateId()}`,
      otherOwner: `auth0|m0141-other-${generateId()}`,
    });
    await connection.unsafe(
      'DROP INDEX IF EXISTS "entity_tags_org_name_unique"'
    );
  });

  afterEach(async () => {
    await teardownOrg(d);
    await connection.unsafe(INDEX);
    await connection.end();
  });

  it("keeps each name's oldest live tag and renames the rest by id", async () => {
    const oldest = await tag(fx.orgId, "Q4", 1000);
    const second = await tag(fx.orgId, "Q4", 2000);
    const third = await tag(fx.orgId, "Q4", 3000);

    await runMigration();

    expect(await nameOf(oldest)).toBe("Q4");
    expect(await nameOf(second)).toBe(`Q4 (${second.slice(0, 8)})`);
    expect(await nameOf(third)).toBe(`Q4 (${third.slice(0, 8)})`);
  });

  it("leaves deleted tags, other orgs and distinct names alone", async () => {
    const deleted = await tag(fx.orgId, "Q4", 500, Date.now());
    const live = await tag(fx.orgId, "Q4", 1000);
    const foreign = await tag(fx.otherOrgId, "Q4", 900);
    const other = await tag(fx.orgId, "Finance", 1000);

    await runMigration();

    expect(await nameOf(deleted)).toBe("Q4");
    expect(await nameOf(live)).toBe("Q4");
    expect(await nameOf(foreign)).toBe("Q4");
    expect(await nameOf(other)).toBe("Finance");
  });

  it("creates the index, after which a duplicate live name is refused", async () => {
    await runMigration();

    await tag(fx.orgId, "Finance", 1000);
    await expect(tag(fx.orgId, "Finance", 2000)).rejects.toMatchObject({
      cause: { code: "23505" },
    });
  });

  it("re-runs as a no-op", async () => {
    const a = await tag(fx.orgId, "Q4", 1000);
    const b = await tag(fx.orgId, "Q4", 2000);
    await runMigration();
    await connection.unsafe(
      'DROP INDEX IF EXISTS "entity_tags_org_name_unique"'
    );

    await runMigration();

    expect(await nameOf(a)).toBe("Q4");
    expect(await nameOf(b)).toBe(`Q4 (${b.slice(0, 8)})`);
  });
});
