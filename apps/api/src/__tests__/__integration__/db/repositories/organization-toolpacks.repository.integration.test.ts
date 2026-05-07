/**
 * Integration tests for the OrganizationToolpacksRepository.
 *
 * Tests run against a real PostgreSQL database spun up by the
 * integration-test setup.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
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
      // Phase-6 column: provide a `whsec_*` plaintext so the repository's
      // encryptInsert helper recognises it and writes the encrypted blob.
      signingSecret: "whsec_test_fixture_default",
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

  // ── authHeaders encryption (phase 5) ─────────────────────────────

  /**
   * Read the raw `auth_headers` column without going through the
   * repository, so assertions can confirm the on-disk shape is
   * opaque rather than the decrypted plaintext map the repository
   * hands back.
   */
  async function readRawAuthHeaders(id: string): Promise<string | null> {
    const rows = await (db as ReturnType<typeof drizzle>)
      .select({ authHeaders: schema.organizationToolpacks.authHeaders })
      .from(schema.organizationToolpacks)
      .where(eq(schema.organizationToolpacks.id, id))
      .limit(1);
    return (rows[0]?.authHeaders ?? null) as string | null;
  }

  // Case 130
  it("create encrypts authHeaders before insert", async () => {
    const row = makeRow({
      authHeaders: { Authorization: "Bearer abc123" },
    });
    const created = await repo.create(row as never, db);

    // Repository hands back the decrypted map.
    expect(created.authHeaders).toEqual({ Authorization: "Bearer abc123" });

    // The on-disk column is an opaque ciphertext envelope.
    const raw = await readRawAuthHeaders(created.id);
    expect(typeof raw).toBe("string");
    expect(raw).not.toContain("abc123");
    expect(raw).not.toContain("Bearer");
    const payload = JSON.parse(raw as string);
    expect(payload).toEqual(
      expect.objectContaining({
        iv: expect.any(String),
        authTag: expect.any(String),
        data: expect.any(String),
        v: 1,
      })
    );
  });

  // Case 131
  it("findByIdScoped decrypts authHeaders on read", async () => {
    const row = makeRow({
      authHeaders: { Authorization: "Bearer abc123" },
    });
    await repo.create(row as never, db);

    const found = await repo.findByIdScoped(row.id as string, orgId, db);
    expect(found?.authHeaders).toEqual({ Authorization: "Bearer abc123" });
  });

  // Case 132
  it("findByOrganizationId decrypts every row, preserving null", async () => {
    const withHeaders = makeRow({
      authHeaders: { "X-Api-Key": "k1" },
    });
    const withoutHeaders = makeRow({
      id: generateId(),
      name: "other_pack",
      authHeaders: null,
    });
    await repo.create(withHeaders as never, db);
    await repo.create(withoutHeaders as never, db);

    const live = await repo.findByOrganizationId(orgId, db);
    const byName = Object.fromEntries(live.map((r) => [r.name, r]));
    expect(byName["customer_intel"]?.authHeaders).toEqual({
      "X-Api-Key": "k1",
    });
    expect(byName["other_pack"]?.authHeaders).toBeNull();
  });

  // Case 133
  it("update preserves the encrypted blob on no-touch and re-encrypts on touch", async () => {
    const row = makeRow({
      authHeaders: { "X-Api-Key": "k1" },
    });
    const created = await repo.create(row as never, db);
    const blobBefore = await readRawAuthHeaders(created.id);
    expect(blobBefore).toBeTruthy();

    // (a) No-touch update on a different field — blob unchanged byte-for-byte.
    await repo.update(created.id, { name: "renamed_pack" } as never, db);
    const blobAfterRename = await readRawAuthHeaders(created.id);
    expect(blobAfterRename).toBe(blobBefore);

    // (b) Touch update — fresh IV + ciphertext, decrypts to the new map.
    await repo.update(
      created.id,
      { authHeaders: { "X-Api-Key": "k2" } } as never,
      db
    );
    const blobAfterTouch = await readRawAuthHeaders(created.id);
    expect(blobAfterTouch).not.toBe(blobBefore);
    const found = await repo.findByIdScoped(created.id, orgId, db);
    expect(found?.authHeaders).toEqual({ "X-Api-Key": "k2" });
  });

  // Case 134
  it("null authHeaders round-trip stores SQL NULL", async () => {
    const row = makeRow({ authHeaders: null });
    const created = await repo.create(row as never, db);
    expect(created.authHeaders).toBeNull();

    const raw = await readRawAuthHeaders(created.id);
    expect(raw).toBeNull();

    const found = await repo.findByIdScoped(created.id, orgId, db);
    expect(found?.authHeaders).toBeNull();
  });

  // ── signingSecret encryption (phase 6) ───────────────────────────

  /**
   * Read the raw `signing_secret` column without going through the
   * repository, mirroring `readRawAuthHeaders`.
   */
  async function readRawSigningSecret(id: string): Promise<string> {
    const rows = await (db as ReturnType<typeof drizzle>)
      .select({ signingSecret: schema.organizationToolpacks.signingSecret })
      .from(schema.organizationToolpacks)
      .where(eq(schema.organizationToolpacks.id, id))
      .limit(1);
    return rows[0]!.signingSecret;
  }

  // Case 149
  it("create encrypts signingSecret before insert", async () => {
    const row = makeRow({ signingSecret: "whsec_test149" });
    const created = await repo.create(row as never, db);

    // Repository hands back the decrypted plaintext.
    expect(created.signingSecret).toBe("whsec_test149");

    // The on-disk column is an opaque ciphertext envelope.
    const raw = await readRawSigningSecret(created.id);
    expect(typeof raw).toBe("string");
    expect(raw).not.toContain("whsec_test149");
    expect(raw).not.toContain("test149");
    const payload = JSON.parse(raw);
    expect(payload).toEqual(
      expect.objectContaining({
        iv: expect.any(String),
        authTag: expect.any(String),
        data: expect.any(String),
        v: 1,
      })
    );
  });

  // Case 150
  it("findByOrganizationId decrypts signingSecret on every row", async () => {
    const a = makeRow({ signingSecret: "whsec_pack_A" });
    const b = makeRow({
      id: generateId(),
      name: "other_pack",
      signingSecret: "whsec_pack_B",
    });
    await repo.create(a as never, db);
    await repo.create(b as never, db);

    const live = await repo.findByOrganizationId(orgId, db);
    const byName = Object.fromEntries(live.map((r) => [r.name, r]));
    expect(byName["customer_intel"]?.signingSecret).toBe("whsec_pack_A");
    expect(byName["other_pack"]?.signingSecret).toBe("whsec_pack_B");
  });

  // Case 151
  it("rotation: update with a new plaintext re-encrypts; old value unrecoverable", async () => {
    const row = makeRow({ signingSecret: "whsec_old" });
    const created = await repo.create(row as never, db);
    const blobBefore = await readRawSigningSecret(created.id);
    expect(blobBefore).toBeTruthy();

    await repo.update(
      created.id,
      { signingSecret: "whsec_new" } as never,
      db
    );

    const blobAfter = await readRawSigningSecret(created.id);
    expect(blobAfter).not.toBe(blobBefore);

    const found = await repo.findByIdScoped(created.id, orgId, db);
    expect(found?.signingSecret).toBe("whsec_new");

    // The old plaintext is no longer recoverable from the new blob.
    expect(blobAfter).not.toContain("whsec_old");
  });
});
