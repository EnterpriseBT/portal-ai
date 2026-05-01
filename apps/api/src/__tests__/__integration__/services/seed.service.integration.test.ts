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

    it("should insert 26 system column definitions for the organization", async () => {
      await seedService.seedSystemColumnDefinitions(organizationId, db);

      const rows = await columnDefsRepo.findByOrganizationId(
        organizationId,
        db
      );

      expect(rows).toHaveLength(26);
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
        "integer",
        "json_data",
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

      expect(rows).toHaveLength(26);
    });

    it("should use deterministic IDs — running twice produces the same IDs", async () => {
      await seedService.seedSystemColumnDefinitions(organizationId, db);
      const first = await columnDefsRepo.findByKey(organizationId, "uuid", db);

      await seedService.seedSystemColumnDefinitions(organizationId, db);
      const second = await columnDefsRepo.findByKey(organizationId, "uuid", db);

      expect(first?.id).toBe(second?.id);
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

      expect(rowsA).toHaveLength(26);
      expect(rowsB).toHaveLength(26);

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
});
