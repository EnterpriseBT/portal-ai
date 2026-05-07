/**
 * Integration tests for the OrganizationToolpacksRepository.
 *
 * Tests run against a real PostgreSQL database spun up by the
 * integration-test setup.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { OrganizationToolpacksRepository } from "../../../../db/repositories/organization-toolpacks.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("OrganizationToolpacksRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: OrganizationToolpacksRepository;
  let orgId: string;
  let otherOrgId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new OrganizationToolpacksRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    const org = createOrganization(user.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;

    const otherUser = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(otherUser as never);
    const otherOrg = createOrganization(otherUser.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(otherOrg as never);
    otherOrgId = otherOrg.id;
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Helpers ──────────────────────────────────────────────────────

  function makeRow(overrides?: Partial<Record<string, unknown>>) {
    const now = Date.now();
    return {
      id: generateId(),
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: orgId,
      name: "customer_intel",
      description: null,
      endpoints: {
        schema: "https://example.com/schema",
        runtime: "https://example.com/runtime",
      },
      authHeaders: null,
      tools: [
        {
          name: "lookup_company",
          description: "Look up a company.",
          parameterSchema: { type: "object", properties: {} },
        },
      ],
      metadata: null,
      schemaFetchedAt: now,
      metadataFetchedAt: null,
      ...overrides,
    };
  }

  // ── Tests ────────────────────────────────────────────────────────

  // Case 73
  it("round-trips a row insert + read", async () => {
    const row = makeRow();
    const created = await repo.create(row as never, db);
    expect(created.id).toBe(row.id);
    expect(created.organizationId).toBe(orgId);
    expect(created.name).toBe("customer_intel");

    const found = await repo.findByOrganizationId(orgId, db);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(row.id);
  });

  // Case 74
  it("rejects duplicate (organizationId, name) live rows", async () => {
    await repo.create(makeRow() as never, db);
    await expect(
      repo.create(makeRow({ id: generateId() }) as never, db)
    ).rejects.toThrow();
  });

  // Case 75
  it("releases the unique-name slot after soft-delete", async () => {
    const first = await repo.create(makeRow() as never, db);
    await repo.softDelete(first.id, "SYSTEM_TEST", db);
    const second = await repo.create(
      makeRow({ id: generateId() }) as never,
      db
    );
    expect(second.id).not.toBe(first.id);
  });

  // Case 76
  it("findByOrganizationId omits soft-deleted rows", async () => {
    const a = await repo.create(makeRow() as never, db);
    await repo.create(
      makeRow({ id: generateId(), name: "other_pack" }) as never,
      db
    );
    await repo.softDelete(a.id, "SYSTEM_TEST", db);

    const live = await repo.findByOrganizationId(orgId, db);
    expect(live.map((r) => r.name)).toEqual(["other_pack"]);
  });

  // Case 77
  it("findManyByIds scoped to org refuses cross-org ids", async () => {
    const ours = await repo.create(makeRow() as never, db);
    const theirs = await repo.create(
      makeRow({
        id: generateId(),
        organizationId: otherOrgId,
        name: "their_pack",
      }) as never,
      db
    );

    const result = await repo.findManyByIds(
      [ours.id, theirs.id],
      { organizationId: orgId },
      db
    );
    expect(result.map((r) => r.id)).toEqual([ours.id]);
  });
});
