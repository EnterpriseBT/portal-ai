/**
 * Integration tests for SeedService.
 *
 * Runs against the real postgres-test database spun up by docker-compose.
 * Verifies that connector definitions are seeded correctly via upsert,
 * including transaction commit/rollback behaviour.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { Repository } from "../../../db/repositories/base.repository.js";
import { SeedService } from "../../../services/seed.service.js";
import { ColumnDefinitionsRepository } from "../../../db/repositories/column-definitions.repository.js";
import { seedUserAndOrg, teardownOrg } from "../utils/application.util.js";

const { connectorDefinitions } = schema;

describe("SeedService Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let seedService: SeedService;
  let connectorDefsRepo: Repository<
    typeof connectorDefinitions,
    schema.ConnectorDefinitionSelect,
    schema.ConnectorDefinitionInsert
  >;
  let columnDefsRepo: ColumnDefinitionsRepository;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    seedService = new SeedService();
    connectorDefsRepo = new Repository(connectorDefinitions);
    columnDefsRepo = new ColumnDefinitionsRepository();

    // Clean tables in FK-safe order
    await teardownOrg(db);
  });

  afterEach(async () => {
    await connection.end();
  });

  describe("seed", () => {
    it("should insert connector definitions into the database", async () => {
      await seedService.seed();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);

      expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    it("should create a File Upload connector definition with correct fields", async () => {
      await seedService.seed();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);
      const fileUpload = rows.find((r) => r.slug === "file-upload");

      expect(fileUpload).toBeDefined();
      expect(fileUpload?.display).toBe("File Upload");
      expect(fileUpload?.category).toBe("File-based");
      expect(fileUpload?.authType).toBe("none");
      expect(fileUpload?.isActive).toBe(true);
      expect(fileUpload?.version).toBe("1.0.0");
      expect(fileUpload?.configSchema).toEqual({});
      expect(fileUpload?.capabilityFlags).toEqual({
        sync: false,
        read: true,
        write: true,
        push: false,
      });
    });

    it("should create a Sandbox connector definition with correct fields", async () => {
      await seedService.seed();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);
      const sandbox = rows.find((r) => r.slug === "sandbox");

      expect(sandbox).toBeDefined();
      expect(sandbox?.display).toBe("Sandbox");
      expect(sandbox?.category).toBe("Built-in");
      expect(sandbox?.authType).toBe("none");
      expect(sandbox?.isActive).toBe(true);
      expect(sandbox?.version).toBe("1.0.0");
      expect(sandbox?.configSchema).toEqual({});
      expect(sandbox?.capabilityFlags).toEqual({
        sync: false,
        read: true,
        write: true,
        push: false,
      });
    });

    it("should be idempotent — running seed twice should not duplicate rows", async () => {
      await seedService.seed();
      await seedService.seed();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);
      const fileUploadRows = rows.filter((r) => r.slug === "file-upload");

      expect(fileUploadRows).toHaveLength(1);
    });

    it("should be idempotent for sandbox — running seed twice should not duplicate rows", async () => {
      await seedService.seed();
      await seedService.seed();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);
      const sandboxRows = rows.filter((r) => r.slug === "sandbox");

      expect(sandboxRows).toHaveLength(1);
    });

    it("should create a Google Sheets connector definition with correct fields", async () => {
      await seedService.seed();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);
      const gsheets = rows.find((r) => r.slug === "google-sheets");

      expect(gsheets).toBeDefined();
      expect(gsheets?.display).toBe("Google Sheets");
      expect(gsheets?.category).toBe("File-based");
      expect(gsheets?.authType).toBe("oauth2");
      // Phase C flipped this on once the workflow shell landed.
      expect(gsheets?.isActive).toBe(true);
      expect(gsheets?.version).toBe("1.0.0");
      expect(gsheets?.configSchema).toEqual({});
      expect(gsheets?.capabilityFlags).toEqual({
        sync: true,
        read: true,
        write: false,
        push: false,
      });
    });

    it("should be idempotent for google-sheets — running seed twice should not duplicate rows", async () => {
      await seedService.seed();
      await seedService.seed();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);
      const gsheetsRows = rows.filter((r) => r.slug === "google-sheets");

      expect(gsheetsRows).toHaveLength(1);
    });

    it("should update existing connector definitions on re-seed (upsert)", async () => {
      await seedService.seed();

      const before = await connectorDefsRepo.findMany(undefined, {}, db);
      const fileUploadBefore = before.find((r) => r.slug === "file-upload");
      expect(fileUploadBefore).toBeDefined();

      // Seed again — the upsert should update, not create a duplicate
      await seedService.seed();

      const after = await connectorDefsRepo.findMany(undefined, {}, db);
      const fileUploadAfter = after.find((r) => r.slug === "file-upload");

      expect(fileUploadAfter).toBeDefined();
      expect(fileUploadAfter?.id).toBe(fileUploadBefore?.id);
    });
  });

  describe("seedConnectorDefinitions", () => {
    it("should insert connectors using the provided db client", async () => {
      await seedService.seedConnectorDefinitions(db);

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);

      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.find((r) => r.slug === "file-upload")).toBeDefined();
    });

    it("should work within a transaction that can be rolled back", async () => {
      const { tx, rollback } = await Repository.createTransactionClient();

      await seedService.seedConnectorDefinitions(tx);
      await rollback();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);

      expect(rows).toHaveLength(0);
    });

    it("should work within a transaction that can be committed", async () => {
      const { tx, commit } = await Repository.createTransactionClient();

      await seedService.seedConnectorDefinitions(tx);
      await commit();

      const rows = await connectorDefsRepo.findMany(undefined, {}, db);

      expect(rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("seedSystemColumnDefinitions", () => {
    let organizationId: string;

    beforeEach(async () => {
      const seed = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        "auth0|seed-col-test"
      );
      organizationId = seed.organizationId;
    });

    it("should insert 29 system column definitions for the organization", async () => {
      await seedService.seedSystemColumnDefinitions(organizationId, db);

      const rows = await columnDefsRepo.findByOrganizationId(
        organizationId,
        db
      );

      expect(rows).toHaveLength(29);
    });

    it("should persist system: true for every seeded definition", async () => {
      await seedService.seedSystemColumnDefinitions(organizationId, db);

      const rows = await columnDefsRepo.findByOrganizationId(
        organizationId,
        db
      );

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.system === true)).toBe(true);
    });

    it("should create column definitions with correct keys", async () => {
      await seedService.seedSystemColumnDefinitions(organizationId, db);

      const rows = await columnDefsRepo.findByOrganizationId(
        organizationId,
        db
      );
      const keys = rows.map((r) => r.key).sort();

      expect(keys).toEqual([
        "address",
        "array",
        "boolean",
        "code",
        "currency",
        "date",
        "datetime",
        "decimal",
        "description",
        "email",
        "enum",
        "geometry",
        "integer",
        "json_data",
        "latitude",
        "longitude",
        "name",
        "number_id",
        "percentage",
        "phone",
        "quantity",
        "reference",
        "reference_array",
        "status",
        "string_id",
        "tag",
        "text",
        "url",
        "uuid",
      ]);
    });

    it("should create email column definition with correct fields", async () => {
      await seedService.seedSystemColumnDefinitions(organizationId, db);

      const email = await columnDefsRepo.findByKey(organizationId, "email", db);

      expect(email).toBeDefined();
      expect(email?.label).toBe("Email");
      expect(email?.type).toBe("string");
      expect(email?.description).toBe("Email address");
      expect(email?.validationPattern).toBe("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
      expect(email?.validationMessage).toBe("Must be a valid email address");
      expect(email?.canonicalFormat).toBe("lowercase");
    });

    it("should create currency column definition with correct fields", async () => {
      await seedService.seedSystemColumnDefinitions(organizationId, db);

      const currency = await columnDefsRepo.findByKey(
        organizationId,
        "currency",
        db
      );

      expect(currency).toBeDefined();
      expect(currency?.label).toBe("Currency");
      expect(currency?.type).toBe("number");
      expect(currency?.canonicalFormat).toBe("$#,##0.00");
    });

    it("should create date column definition with null validation fields", async () => {
      await seedService.seedSystemColumnDefinitions(organizationId, db);

      const date = await columnDefsRepo.findByKey(organizationId, "date", db);

      expect(date).toBeDefined();
      expect(date?.type).toBe("date");
      expect(date?.validationPattern).toBeNull();
      expect(date?.validationMessage).toBeNull();
      expect(date?.canonicalFormat).toBeNull();
    });

    it("should be idempotent — running twice should not duplicate rows", async () => {
      await seedService.seedSystemColumnDefinitions(organizationId, db);
      await seedService.seedSystemColumnDefinitions(organizationId, db);

      const rows = await columnDefsRepo.findByOrganizationId(
        organizationId,
        db
      );

      expect(rows).toHaveLength(29);
    });

    it("should seed the geo definitions with the right type and role (#316)", async () => {
      await seedService.seedSystemColumnDefinitions(organizationId, db);

      const geometry = await columnDefsRepo.findByKey(
        organizationId,
        "geometry",
        db
      );
      expect(geometry?.type).toBe("geometry");
      // geometry is a type, not a role — its role is null.
      expect(geometry?.geoRole).toBeNull();

      const latitude = await columnDefsRepo.findByKey(
        organizationId,
        "latitude",
        db
      );
      expect(latitude?.type).toBe("number");
      expect(latitude?.geoRole).toBe("lat");

      const longitude = await columnDefsRepo.findByKey(
        organizationId,
        "longitude",
        db
      );
      expect(longitude?.type).toBe("number");
      expect(longitude?.geoRole).toBe("lng");
    });

    it("should not duplicate the geo definitions on re-seed (#316)", async () => {
      await seedService.seedSystemColumnDefinitions(organizationId, db);
      await seedService.seedSystemColumnDefinitions(organizationId, db);

      const rows = await columnDefsRepo.findByOrganizationId(
        organizationId,
        db
      );
      const geoKeys = rows
        .filter((r) => ["geometry", "latitude", "longitude"].includes(r.key))
        .map((r) => r.key)
        .sort();

      // three geo rows, not six
      expect(geoKeys).toEqual(["geometry", "latitude", "longitude"]);
    });

    // #414: this previously read "should use deterministic IDs". It passed
    // vacuously — ids are v4 (`seed.service.ts` calls `id.v4.generate()`), and
    // the id survives a re-seed only because `upsertByKey`'s ON CONFLICT never
    // lands the second insert. What actually holds is stability, not
    // derivation, so that is what is asserted.
    it("should neither duplicate nor renumber rows when re-seeded", async () => {
      await seedService.seedSystemColumnDefinitions(organizationId, db);
      const first = await columnDefsRepo.findByKey(organizationId, "uuid", db);

      await seedService.seedSystemColumnDefinitions(organizationId, db);
      const second = await columnDefsRepo.findByKey(organizationId, "uuid", db);

      expect(second?.id).toBe(first?.id);

      const rows = await columnDefsRepo.findByOrganizationId(
        organizationId,
        db
      );
      expect(rows).toHaveLength(29);
    });

    // #414: `upsertByKey`'s `set` clause omitted `geoRole` and `system`, so a
    // re-seed could not converge the two fields #316 added. Corrupt them on a
    // live row, re-seed, and require the seeded values back.
    it("should converge geoRole and system on an existing row", async () => {
      await seedService.seedSystemColumnDefinitions(organizationId, db);

      await db.execute(sql`
        UPDATE column_definitions
        SET geo_role = NULL, system = false
        WHERE organization_id = ${organizationId} AND key = 'latitude'
      `);

      await seedService.seedSystemColumnDefinitions(organizationId, db);

      const latitude = await columnDefsRepo.findByKey(
        organizationId,
        "latitude",
        db
      );
      expect(latitude?.geoRole).toBe("lat");
      expect(latitude?.system).toBe(true);
    });

    it("should scope definitions to the given organization", async () => {
      const seedB = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        "auth0|seed-col-test-b"
      );

      await seedService.seedSystemColumnDefinitions(organizationId, db);
      await seedService.seedSystemColumnDefinitions(seedB.organizationId, db);

      const rowsA = await columnDefsRepo.findByOrganizationId(
        organizationId,
        db
      );
      const rowsB = await columnDefsRepo.findByOrganizationId(
        seedB.organizationId,
        db
      );

      expect(rowsA).toHaveLength(29);
      expect(rowsB).toHaveLength(29);

      // IDs should differ between organizations
      const uuidA = rowsA.find((r) => r.key === "uuid");
      const uuidB = rowsB.find((r) => r.key === "uuid");
      expect(uuidA?.id).not.toBe(uuidB?.id);
    });

    it("should work within a transaction that can be rolled back", async () => {
      const { tx, rollback } = await Repository.createTransactionClient();

      await seedService.seedSystemColumnDefinitions(organizationId, tx);
      await rollback();

      const rows = await columnDefsRepo.findByOrganizationId(
        organizationId,
        db
      );

      expect(rows).toHaveLength(0);
    });
  });

  /**
   * #414: the 0080 backfill migration. The migration runner applies it before
   * the suite truncates, so by the time a test runs there are no organizations
   * for it to have touched — the only way to cover its INSERT is to apply the
   * SQL directly against an org staged to look pre-#316.
   */
  describe("0080 geospatial backfill migration", () => {
    const GEO_KEYS = ["geometry", "latitude", "longitude"] as const;
    let organizationId: string;
    let migrationSql: string;

    beforeEach(async () => {
      const seed = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        "auth0|seed-backfill-test"
      );
      organizationId = seed.organizationId;

      const here = dirname(fileURLToPath(import.meta.url));
      migrationSql = await readFile(
        join(
          here,
          "../../../../drizzle/0080_backfill-geospatial-column-definitions.sql"
        ),
        "utf-8"
      );

      // Stage a pre-#316 catalog: seed all 29, then remove the geo trio.
      await seedService.seedSystemColumnDefinitions(organizationId, db);
      await db.execute(sql`
        DELETE FROM column_definitions
        WHERE organization_id = ${organizationId}
          AND key IN ('geometry', 'latitude', 'longitude')
      `);
      const staged = await columnDefsRepo.findByOrganizationId(
        organizationId,
        db
      );
      expect(staged).toHaveLength(26);
    });

    it("should insert the three geospatial definitions with the right type and role", async () => {
      await db.execute(sql.raw(migrationSql));

      const rows = await columnDefsRepo.findByOrganizationId(
        organizationId,
        db
      );
      expect(rows).toHaveLength(29);

      const byKey = new Map(rows.map((r) => [r.key, r]));

      expect(byKey.get("geometry")).toMatchObject({
        type: "geometry",
        geoRole: null,
        system: true,
      });
      expect(byKey.get("latitude")).toMatchObject({
        type: "number",
        geoRole: "lat",
        system: true,
      });
      expect(byKey.get("longitude")).toMatchObject({
        type: "number",
        geoRole: "lng",
        system: true,
      });
    });

    it("should be a no-op on an organization that already has them", async () => {
      await db.execute(sql.raw(migrationSql));
      const first = await columnDefsRepo.findByOrganizationId(
        organizationId,
        db
      );
      const firstIds = first
        .filter((r) => GEO_KEYS.includes(r.key as (typeof GEO_KEYS)[number]))
        .map((r) => r.id)
        .sort();

      // Re-applying is what happens on any environment already complete —
      // prod and local both were when this shipped.
      await db.execute(sql.raw(migrationSql));

      const second = await columnDefsRepo.findByOrganizationId(
        organizationId,
        db
      );
      expect(second).toHaveLength(29);

      const secondIds = second
        .filter((r) => GEO_KEYS.includes(r.key as (typeof GEO_KEYS)[number]))
        .map((r) => r.id)
        .sort();
      expect(secondIds).toEqual(firstIds);
    });

    it("should skip soft-deleted organizations", async () => {
      const seedB = await seedUserAndOrg(
        db as ReturnType<typeof drizzle>,
        "auth0|seed-backfill-deleted-org"
      );
      await db.execute(sql`
        DELETE FROM column_definitions WHERE organization_id = ${seedB.organizationId}
      `);
      await db.execute(sql`
        UPDATE organizations SET deleted = 1 WHERE id = ${seedB.organizationId}
      `);

      await db.execute(sql.raw(migrationSql));

      const rowsB = await columnDefsRepo.findByOrganizationId(
        seedB.organizationId,
        db
      );
      expect(rowsB).toHaveLength(0);
    });
  });
});
