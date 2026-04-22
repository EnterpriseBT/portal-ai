/**
 * Integration tests for `reconcileFieldMappings`.
 *
 * Covers the binding-override surface added by `docs/BINDING_OVERRIDES.spec.md`:
 * excluded bindings are dropped, per-binding overrides (`normalizedKey`,
 * `required`, `defaultValue`, `format`, `enumValues`) land on the materialised
 * `FieldMapping` row, normalized-key regex + uniqueness are enforced, and
 * reference-typed bindings are validated against staged + DB entities.
 *
 * Runs against the real postgres-test database spun up by docker-compose.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../../db/schema/index.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../../constants/api-codes.constants.js";
import { ApiError } from "../../../../services/http.service.js";
import { reconcileFieldMappings } from "../../../../services/field-mappings/reconcile.js";
import type {
  ColumnDefinitionSelect,
  FieldMappingSelect,
} from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("reconcileFieldMappings — integration", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  let orgId: string;
  let userId: string;
  let connectorInstanceId: string;
  let subjectEntityId: string;
  let dbRefEntityId: string;
  let colStringId: string;
  let colStringAltId: string;
  let colReferenceId: string;
  const dbRefEntityKey = "existing_customers";

  let catalogById: Map<string, ColumnDefinitionSelect>;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set — setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);

    const now = Date.now();
    const dbTyped = db as ReturnType<typeof drizzle>;

    // user + org
    const user = createUser(`auth0|${generateId()}`);
    await dbTyped.insert(schema.users).values(user as never);
    userId = user.id;
    const org = createOrganization(userId);
    await dbTyped.insert(schema.organizations).values(org as never);
    orgId = org.id;

    // connector def + instance
    const connDefId = generateId();
    await dbTyped.insert(schema.connectorDefinitions).values({
      id: connDefId,
      slug: `test-${generateId().slice(0, 8)}`,
      display: "Test",
      category: "file",
      authType: "none",
      configSchema: {},
      capabilityFlags: { read: true, write: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    connectorInstanceId = generateId();
    await dbTyped.insert(schema.connectorInstances).values({
      id: connectorInstanceId,
      connectorDefinitionId: connDefId,
      organizationId: orgId,
      name: "Test Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    // subject entity (the one we reconcile against)
    subjectEntityId = generateId();
    await dbTyped.insert(schema.connectorEntities).values({
      id: subjectEntityId,
      organizationId: orgId,
      connectorInstanceId,
      key: "contacts",
      label: "Contacts",
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    // pre-existing reference target entity (same org, different instance)
    const dbRefInstanceId = generateId();
    await dbTyped.insert(schema.connectorInstances).values({
      id: dbRefInstanceId,
      connectorDefinitionId: connDefId,
      organizationId: orgId,
      name: "DB Ref Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    dbRefEntityId = generateId();
    await dbTyped.insert(schema.connectorEntities).values({
      id: dbRefEntityId,
      organizationId: orgId,
      connectorInstanceId: dbRefInstanceId,
      key: dbRefEntityKey,
      label: "Existing Customers",
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    // column definitions
    colStringId = generateId();
    colStringAltId = generateId();
    colReferenceId = generateId();
    await dbTyped.insert(schema.columnDefinitions).values([
      {
        id: colStringId,
        organizationId: orgId,
        key: "email",
        label: "Email",
        type: "string",
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        system: false,
        created: now,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
      {
        id: colStringAltId,
        organizationId: orgId,
        key: "name",
        label: "Name",
        type: "string",
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        system: false,
        created: now,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
      {
        id: colReferenceId,
        organizationId: orgId,
        key: "customer_ref",
        label: "Customer",
        type: "reference",
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        system: false,
        created: now,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ] as never);

    // Seed a field mapping on the DB ref entity so refNormalizedKey lookups
    // against an existing entity have something to resolve.
    await dbTyped.insert(schema.fieldMappings).values({
      id: generateId(),
      organizationId: orgId,
      connectorEntityId: dbRefEntityId,
      columnDefinitionId: colStringId,
      sourceField: "id",
      isPrimaryKey: true,
      normalizedKey: "id",
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refNormalizedKey: null,
      refEntityKey: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    catalogById = new Map([
      [
        colStringId,
        {
          id: colStringId,
          organizationId: orgId,
          key: "email",
          label: "Email",
          type: "string",
          description: null,
          validationPattern: null,
          validationMessage: null,
          canonicalFormat: null,
          system: false,
          created: now,
          createdBy: "test-system",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as ColumnDefinitionSelect,
      ],
      [
        colStringAltId,
        {
          id: colStringAltId,
          organizationId: orgId,
          key: "name",
          label: "Name",
          type: "string",
          description: null,
          validationPattern: null,
          validationMessage: null,
          canonicalFormat: null,
          system: false,
          created: now,
          createdBy: "test-system",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as ColumnDefinitionSelect,
      ],
      [
        colReferenceId,
        {
          id: colReferenceId,
          organizationId: orgId,
          key: "customer_ref",
          label: "Customer",
          type: "reference",
          description: null,
          validationPattern: null,
          validationMessage: null,
          canonicalFormat: null,
          system: false,
          created: now,
          createdBy: "test-system",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as ColumnDefinitionSelect,
      ],
    ]);
  });

  afterEach(async () => {
    await connection.end();
  });

  async function readMappings(): Promise<FieldMappingSelect[]> {
    return (await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.fieldMappings)
      .where(
        eq(schema.fieldMappings.connectorEntityId, subjectEntityId)
      )) as FieldMappingSelect[];
  }

  // ── Baseline + override happy paths ────────────────────────────────

  describe("overrides", () => {
    it("writes source-derived defaults when no overrides are set", async () => {
      await reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            { columnDefinitionId: colStringId, sourceField: "Email" },
          ],
          catalogById,
        },
        db
      );
      const rows = await readMappings();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        normalizedKey: "email",
        required: false,
        defaultValue: null,
        enumValues: null,
        refEntityKey: null,
        refNormalizedKey: null,
      });
    });

    it("derives normalizedKey from the source field name (not the catalog key) when no override is set", async () => {
      // Source is "Customer Name" but the bound ColumnDefinition's key is
      // "name". Commit should derive "customer_name" from the source, not
      // fall back to the catalog's key — so two bindings pointing at the
      // same definition but different source columns produce distinct rows.
      await reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            {
              columnDefinitionId: colStringAltId,
              sourceField: "Customer Name",
            },
          ],
          catalogById,
        },
        db
      );
      const rows = await readMappings();
      expect(rows).toHaveLength(1);
      expect(rows[0].normalizedKey).toBe("customer_name");
    });

    it("honors binding.normalizedKey over the catalog key", async () => {
      await reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            {
              columnDefinitionId: colStringId,
              sourceField: "Email",
              normalizedKey: "email_override",
            },
          ],
          catalogById,
        },
        db
      );
      const rows = await readMappings();
      expect(rows).toHaveLength(1);
      expect(rows[0].normalizedKey).toBe("email_override");
    });

    it("honors required / defaultValue / format / enumValues overrides", async () => {
      await reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            {
              columnDefinitionId: colStringId,
              sourceField: "Email",
              required: true,
              defaultValue: "unknown@example.com",
              format: "lowercase",
              enumValues: ["A", "B"],
            },
          ],
          catalogById,
        },
        db
      );
      const rows = await readMappings();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        required: true,
        defaultValue: "unknown@example.com",
        format: "lowercase",
        enumValues: ["A", "B"],
      });
    });

    it("skips excluded bindings — no FieldMapping row written for them", async () => {
      await reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            { columnDefinitionId: colStringId, sourceField: "Email" },
            {
              columnDefinitionId: colStringAltId,
              sourceField: "Name",
              excluded: true,
            },
          ],
          catalogById,
        },
        db
      );
      const rows = await readMappings();
      expect(rows).toHaveLength(1);
      expect(rows[0].columnDefinitionId).toBe(colStringId);
    });

    it("soft-deletes an existing mapping whose binding was flipped to excluded on a re-commit", async () => {
      // First commit — two mappings.
      await reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            { columnDefinitionId: colStringId, sourceField: "Email" },
            { columnDefinitionId: colStringAltId, sourceField: "Name" },
          ],
          catalogById,
        },
        db
      );
      const firstRows = await readMappings();
      expect(firstRows.filter((r) => r.deleted === null)).toHaveLength(2);

      // Second commit — name is now excluded. Existing mapping should be soft-deleted.
      await reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            { columnDefinitionId: colStringId, sourceField: "Email" },
            {
              columnDefinitionId: colStringAltId,
              sourceField: "Name",
              excluded: true,
            },
          ],
          catalogById,
        },
        db
      );
      const secondRows = await readMappings();
      const live = secondRows.filter((r) => r.deleted === null);
      expect(live).toHaveLength(1);
      expect(live[0].columnDefinitionId).toBe(colStringId);
      // The previously-live name mapping should now carry a deleted timestamp.
      const nameRow = secondRows.find(
        (r) => r.columnDefinitionId === colStringAltId
      );
      expect(nameRow?.deleted).not.toBeNull();
    });
  });

  // ── Validation ─────────────────────────────────────────────────────

  describe("normalized-key validation", () => {
    it("rejects a binding.normalizedKey that violates the regex", async () => {
      const run = reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            {
              columnDefinitionId: colStringId,
              sourceField: "Email",
              normalizedKey: "Invalid Key",
            },
          ],
          catalogById,
        },
        db
      );
      await expect(run).rejects.toBeInstanceOf(ApiError);
      await expect(run).rejects.toMatchObject({
        code: ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD,
      });
    });

    it("rejects two bindings sharing the same resolved normalizedKey", async () => {
      const run = reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            { columnDefinitionId: colStringId, sourceField: "Email" },
            {
              columnDefinitionId: colStringAltId,
              sourceField: "Name",
              normalizedKey: "email", // collides with catalog-derived key of colStringId
            },
          ],
          catalogById,
        },
        db
      );
      await expect(run).rejects.toBeInstanceOf(ApiError);
      await expect(run).rejects.toMatchObject({
        code: ApiCode.LAYOUT_PLAN_DUPLICATE_NORMALIZED_KEY,
      });
    });
  });

  // ── Reference validation ───────────────────────────────────────────

  describe("reference validation", () => {
    it("accepts a reference binding pointing at a sibling staged entity", async () => {
      await reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            {
              columnDefinitionId: colReferenceId,
              sourceField: "customer_id",
              refEntityKey: "staged_customers",
              refNormalizedKey: "id",
            },
          ],
          catalogById,
          stagedEntityKeys: new Set(["staged_customers"]),
          stagedNormalizedKeysByEntityKey: new Map([
            ["staged_customers", new Set(["id"])],
          ]),
        },
        db
      );
      const rows = await readMappings();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        refEntityKey: "staged_customers",
        refNormalizedKey: "id",
      });
    });

    it("accepts a reference binding pointing at an existing org ConnectorEntity.key", async () => {
      await reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            {
              columnDefinitionId: colReferenceId,
              sourceField: "customer_id",
              refEntityKey: dbRefEntityKey,
              refNormalizedKey: "id",
            },
          ],
          catalogById,
        },
        db
      );
      const rows = await readMappings();
      expect(rows).toHaveLength(1);
      expect(rows[0].refEntityKey).toBe(dbRefEntityKey);
    });

    it("rejects a reference-typed binding with null refEntityKey", async () => {
      const run = reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            {
              columnDefinitionId: colReferenceId,
              sourceField: "customer_id",
              refEntityKey: null,
            },
          ],
          catalogById,
        },
        db
      );
      await expect(run).rejects.toBeInstanceOf(ApiError);
      await expect(run).rejects.toMatchObject({
        code: ApiCode.LAYOUT_PLAN_INVALID_REFERENCE,
      });
    });

    it("rejects a refEntityKey that resolves neither to a staged entity nor an org entity", async () => {
      const run = reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            {
              columnDefinitionId: colReferenceId,
              sourceField: "customer_id",
              refEntityKey: "phantom_entity",
              refNormalizedKey: "id",
            },
          ],
          catalogById,
          stagedEntityKeys: new Set(["other_staged"]),
        },
        db
      );
      await expect(run).rejects.toBeInstanceOf(ApiError);
      await expect(run).rejects.toMatchObject({
        code: ApiCode.LAYOUT_PLAN_INVALID_REFERENCE,
      });
    });

    it("rejects a refNormalizedKey that doesn't exist on the target entity", async () => {
      const run = reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            {
              columnDefinitionId: colReferenceId,
              sourceField: "customer_id",
              refEntityKey: dbRefEntityKey,
              refNormalizedKey: "phantom_field",
            },
          ],
          catalogById,
        },
        db
      );
      await expect(run).rejects.toBeInstanceOf(ApiError);
      await expect(run).rejects.toMatchObject({
        code: ApiCode.LAYOUT_PLAN_INVALID_REFERENCE,
      });
    });

    it("skips reference validation entirely for excluded bindings", async () => {
      // Should not throw despite missing refEntityKey — excluded bindings are
      // dropped before any override validation runs.
      await reconcileFieldMappings(
        {
          connectorEntityId: subjectEntityId,
          organizationId: orgId,
          userId,
          bindings: [
            {
              columnDefinitionId: colReferenceId,
              sourceField: "customer_id",
              excluded: true,
            },
          ],
          catalogById,
        },
        db
      );
      expect(await readMappings()).toHaveLength(0);
    });

    // ── C2 guarantee ──────────────────────────────────────────────
    // The `dbRefEntity*` seed above already sits in a *different*
    // connector instance from the subject entity. Under C2 the org-wide
    // unique `(organization_id, key)` index guarantees one match, so
    // these tests verify reference resolution has no ambiguity.
    describe("C2 — cross-connector reference resolution", () => {
      it("resolves refEntityKey to an entity owned by a different connector in the same org", async () => {
        await reconcileFieldMappings(
          {
            connectorEntityId: subjectEntityId,
            organizationId: orgId,
            userId,
            bindings: [
              {
                columnDefinitionId: colReferenceId,
                sourceField: "customer_id",
                refEntityKey: dbRefEntityKey,
                refNormalizedKey: "id",
              },
            ],
            catalogById,
          },
          db
        );
        const rows = await readMappings();
        expect(rows).toHaveLength(1);
        expect(rows[0].refEntityKey).toBe(dbRefEntityKey);
        expect(rows[0].refNormalizedKey).toBe("id");
      });

      it("errors LAYOUT_PLAN_INVALID_REFERENCE when the key doesn't exist anywhere in the org (regression)", async () => {
        const run = reconcileFieldMappings(
          {
            connectorEntityId: subjectEntityId,
            organizationId: orgId,
            userId,
            bindings: [
              {
                columnDefinitionId: colReferenceId,
                sourceField: "customer_id",
                refEntityKey: "never_seen",
                refNormalizedKey: "id",
              },
            ],
            catalogById,
          },
          db
        );
        await expect(run).rejects.toMatchObject({
          code: ApiCode.LAYOUT_PLAN_INVALID_REFERENCE,
        });
      });
    });
  });
});
