/**
 * #952: migration 0133 relabels the literal system principal ('SYSTEM' /
 * 'system') that earlier data migrations and CLI-spawned scripts wrote, so
 * `created_by_system` grants match those rows again.
 *
 * The global setup has already applied 0133 (an empty test DB has nothing to
 * relabel), so each case seeds literal rows and re-runs the migration's SQL in
 * a transaction with the setting set, the way db-migrate runs it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { PermissionService } from "../../../services/permission.service.js";
import { SeedService } from "../../../services/seed.service.js";
import { generateId, teardownOrg } from "../utils/application.util.js";
import {
  seedPopulatedOrg,
  type PopulatedOrg,
} from "../utils/seed-populated-org.util.js";

const PRINCIPAL = process.env.SYSTEM_ID!;

const MIGRATION = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../drizzle/0133_repair-system-principal.sql"
  ),
  "utf8"
);
const STATEMENTS = MIGRATION.split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

describe("0133 repair-system-principal (#952)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let org!: PopulatedOrg;
  const d = () => db as ReturnType<typeof drizzle>;

  /** Run 0133 as db-migrate does: one transaction, the setting set (or not). */
  async function runRepair(principal: string | null = PRINCIPAL) {
    await connection.begin(async (tx) => {
      if (principal !== null) {
        await tx`SELECT set_config('portalai.system_id', ${principal}, true)`;
      }
      for (const stmt of STATEMENTS) await tx.unsafe(stmt);
    });
  }

  /** `created_by` (and `updated_by`) of every row of `table` in the org. */
  async function creators(table: string, orgCol = "organization_id") {
    return connection.unsafe(
      `SELECT created_by, updated_by FROM "${table}" WHERE "${orgCol}" = $1`,
      [org.orgId]
    );
  }

  /** Relabel the org's rows in `table` to a literal, as a backfill wrote them. */
  async function label(
    table: string,
    value: string,
    orgCol = "organization_id"
  ) {
    await connection.unsafe(
      `UPDATE "${table}" SET created_by = $2 WHERE "${orgCol}" = $1`,
      [org.orgId, value]
    );
  }

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    db = drizzle(connection, { schema }) as unknown as DbClient;
    await teardownOrg(d());
    org = await seedPopulatedOrg(d(), "repair952");
    await new SeedService().seedRbacSystemPolicies(org.orgId, db);
  });

  afterEach(async () => {
    await teardownOrg(d());
    await connection.end();
  });

  it("defines portalai_system_id() (applied by the global migrate)", async () => {
    const [row] = await connection`
      SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'portalai_system_id'`;
    expect(row.n).toBe(1);
  });

  it("rewrites 'SYSTEM' on data objects and 'system' on RBAC rows", async () => {
    for (const t of [
      "stations",
      "connector_instances",
      "connector_entities",
      "curated_views",
      "field_mappings",
    ]) {
      await label(t, "SYSTEM");
    }
    for (const t of [
      "roles",
      "permission_policies",
      "policy_attachments",
      "permission_statements",
    ]) {
      await label(t, "system");
    }
    await connection`UPDATE organizations SET created_by = 'SYSTEM' WHERE id = ${org.orgId}`;

    await runRepair();

    for (const t of [
      "stations",
      "connector_instances",
      "connector_entities",
      "curated_views",
      "field_mappings",
      "roles",
      "permission_policies",
      "policy_attachments",
      "permission_statements",
    ]) {
      const rows = await creators(t);
      expect([t, rows.length > 0]).toEqual([t, true]);
      expect([t, rows.every((r) => r.created_by === PRINCIPAL)]).toEqual([
        t,
        true,
      ]);
    }
    const [o] =
      await connection`SELECT created_by FROM organizations WHERE id = ${org.orgId}`;
    expect(o.created_by).toBe(PRINCIPAL);
  });

  it("rewrites updated_by too", async () => {
    await connection`UPDATE stations SET updated_by = 'system', updated = 1 WHERE id = ${org.stationId}`;
    await runRepair();
    const [s] =
      await connection`SELECT updated_by FROM stations WHERE id = ${org.stationId}`;
    expect(s.updated_by).toBe(PRINCIPAL);
  });

  it("leaves a user-owned row alone", async () => {
    await connection`UPDATE stations SET created_by = ${org.ownerUserId} WHERE id = ${org.stationId}`;
    await runRepair();
    const [s] =
      await connection`SELECT created_by FROM stations WHERE id = ${org.stationId}`;
    expect(s.created_by).toBe(org.ownerUserId);
  });

  it("leaves entity_records and audit_log alone", async () => {
    await label("entity_records", "SYSTEM");
    await d()
      .insert(schema.auditLog)
      .values({
        id: generateId(),
        created: Date.now(),
        createdBy: "SYSTEM",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
        organizationId: org.orgId,
        userId: org.ownerUserId,
        action: "member.invite",
        targetType: null,
        targetId: null,
        outcome: "success",
        sourceIp: null,
        userAgent: null,
        metadata: null,
      } as never);

    await runRepair();

    const records = await creators("entity_records");
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.created_by === "SYSTEM")).toBe(true);
    const audit = await connection`
      SELECT created_by FROM audit_log WHERE organization_id = ${org.orgId}`;
    expect(audit.map((r) => r.created_by)).toEqual(["SYSTEM"]);
  });

  it("is idempotent", async () => {
    await label("stations", "SYSTEM");
    await runRepair();
    const before = await creators("stations");
    await runRepair();
    expect(await creators("stations")).toEqual(before);
  });

  it("raises without the setting and writes nothing", async () => {
    await label("stations", "SYSTEM");
    await expect(runRepair(null)).rejects.toThrow(
      /portalai\.system_id is not set/
    );
    const rows = await creators("stations");
    expect(rows.every((r) => r.created_by === "SYSTEM")).toBe(true);
  });

  it("gives a member back read on the relabeled system objects", async () => {
    await label("stations", "SYSTEM");
    const member = await PermissionService.loadSet(
      {
        userId: org.memberUserId,
        organizationId: org.orgId,
        roles: ["member"],
      },
      db
    );
    const readStation = async () => {
      const [s] = await d()
        .select({ createdBy: schema.stations.createdBy })
        .from(schema.stations)
        .where(eq(schema.stations.id, org.stationId));
      return member.can("resource.read", {
        type: "station",
        id: org.stationId,
        createdBy: s.createdBy,
      });
    };

    expect(await readStation()).toBe(false);
    await runRepair();
    expect(await readStation()).toBe(true);
  });
});
