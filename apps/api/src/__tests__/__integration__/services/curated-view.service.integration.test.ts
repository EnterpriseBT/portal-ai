/**
 * Integration tests for CuratedViewService (#645) — the curated-view logic the
 * REST routes and the `view_management` agent tools share. The routes' own
 * suite (`curated-view.router.integration.test.ts`) pins the behavior they
 * always had; this file covers what only the tools use: projected columns
 * named by key (`columnKeys`).
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";

import { CuratedViewService } from "../../../services/curated-view.service.js";
import type { PermissionContext } from "../../../services/permission.service.js";
import { ApiError } from "../../../services/http.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedRbacForOrg,
  teardownOrg,
} from "../utils/application.util.js";
import {
  seedPopulatedOrg,
  type PopulatedOrg,
} from "../utils/seed-populated-org.util.js";

type Db = ReturnType<typeof drizzle>;

/** Run `fn` and return the `ApiError` it throws (fails if it doesn't). */
async function apiError(fn: () => Promise<unknown>): Promise<ApiError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error("expected an ApiError");
}

describe("CuratedViewService integration tests (#645)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;
  let target!: PopulatedOrg;
  let foreign!: PopulatedOrg;
  let ageFmId!: string;
  let owner!: PermissionContext;

  const dropTables = async () => {
    for (const org of [target, foreign]) {
      if (org) {
        await wideTableReconcilerService.dropTable(
          org.connectorEntityId,
          db as DbClient
        );
      }
    }
  };

  /** Make the org's owner an `owner`, with the org's system roles seeded. */
  async function promoteOwner(org: PopulatedOrg): Promise<void> {
    await seedRbacForOrg(db, org.orgId);
    await db
      .update(schema.organizationUsers)
      .set({ role: "owner" })
      .where(
        and(
          eq(schema.organizationUsers.organizationId, org.orgId),
          eq(schema.organizationUsers.userId, org.ownerUserId)
        )
      );
  }

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });
  });

  afterAll(async () => {
    await dropTables();
    await teardownOrg(db);
    await connection.end();
  });

  beforeEach(async () => {
    await dropTables();
    await teardownOrg(db);
    target = await seedPopulatedOrg(db, "cvs-target");
    foreign = await seedPopulatedOrg(db, "cvs-foreign");
    await promoteOwner(target);
    await promoteOwner(foreign);

    // A second column on the target entity.
    const now = Date.now();
    const ageDefId = generateId();
    await db.insert(schema.columnDefinitions).values({
      id: ageDefId,
      organizationId: target.orgId,
      key: "age",
      label: "Age",
      type: "number",
      created: now,
      createdBy: "SYSTEM_TEST",
    } as never);
    ageFmId = generateId();
    await db.insert(schema.fieldMappings).values({
      id: ageFmId,
      organizationId: target.orgId,
      connectorEntityId: target.connectorEntityId,
      columnDefinitionId: ageDefId,
      sourceField: "age",
      isPrimaryKey: false,
      normalizedKey: "age",
      required: false,
      created: now,
      createdBy: "SYSTEM_TEST",
    } as never);

    owner = {
      userId: target.ownerUserId,
      organizationId: target.orgId,
      roles: ["owner"],
    };
  });

  const createInput = (overrides: Record<string, unknown> = {}) => ({
    connectorEntityId: target.connectorEntityId,
    key: `keyed_${generateId().slice(0, 8)}`,
    label: "Keyed",
    ...overrides,
  });

  describe("columnKeys", () => {
    it("resolves keys to the entity's field mappings", async () => {
      const view = await CuratedViewService.create(
        owner,
        createInput({ columnKeys: ["age", "email"] })
      );
      const got = await CuratedViewService.get(owner, view.id);
      expect([...got.fieldMappingIds].sort()).toEqual(
        [ageFmId, target.fieldMappingId].sort()
      );
      expect(got.columns).toEqual(
        expect.arrayContaining([
          { fieldMappingId: ageFmId, key: "age" },
          { fieldMappingId: target.fieldMappingId, key: "email" },
        ])
      );
    });

    it("refuses an unknown key, naming it (400)", async () => {
      const err = await apiError(() =>
        CuratedViewService.create(
          owner,
          createInput({ columnKeys: ["email", "nope"] })
        )
      );
      expect(err.status).toBe(400);
      expect(err.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
      expect(err.message).toContain('"nope"');
    });

    it("refuses a repeated key (400)", async () => {
      const err = await apiError(() =>
        CuratedViewService.create(
          owner,
          createInput({ columnKeys: ["email", "email"] })
        )
      );
      expect(err.status).toBe(400);
      expect(err.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
    });

    it("refuses columnKeys together with fieldMappingIds (400)", async () => {
      const err = await apiError(() =>
        CuratedViewService.create(
          owner,
          createInput({
            columnKeys: ["email"],
            fieldMappingIds: [target.fieldMappingId],
          })
        )
      );
      expect(err.status).toBe(400);
      expect(err.code).toBe(ApiCode.CURATED_VIEW_INVALID_PAYLOAD);
    });

    it("answers an unreadable entity 404 before looking at any key", async () => {
      const err = await apiError(() =>
        CuratedViewService.create(
          owner,
          createInput({
            connectorEntityId: foreign.connectorEntityId,
            columnKeys: ["nope"],
          })
        )
      );
      expect(err.status).toBe(404);
      expect(err.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
    });

    it("updates a view's projection by key", async () => {
      const view = await CuratedViewService.create(
        owner,
        createInput({ columnKeys: ["email"] })
      );
      await CuratedViewService.update(owner, view.id, { columnKeys: ["age"] });
      const got = await CuratedViewService.get(owner, view.id);
      expect(got.columns).toEqual([{ fieldMappingId: ageFmId, key: "age" }]);
    });

    it("answers an unknown key on a view the caller can't read 404", async () => {
      const foreignOwner: PermissionContext = {
        userId: foreign.ownerUserId,
        organizationId: foreign.orgId,
        roles: ["owner"],
      };
      const view = await CuratedViewService.create(owner, createInput());
      const err = await apiError(() =>
        CuratedViewService.update(foreignOwner, view.id, {
          columnKeys: ["nope"],
        })
      );
      expect(err.status).toBe(404);
      expect(err.code).toBe(ApiCode.CURATED_VIEW_NOT_FOUND);
    });
  });

  describe("provenance (#641)", () => {
    it("records the portal session that created a view", async () => {
      const view = await CuratedViewService.create(owner, createInput(), {
        sourcePortalId: target.portalId,
      });
      expect(view.sourcePortalId).toBe(target.portalId);
      expect(view.createdBy).toBe(target.ownerUserId);
      expect(
        (await CuratedViewService.get(owner, view.id)).sourcePortalId
      ).toBe(target.portalId);
    });

    it("leaves it null for a view made outside a session", async () => {
      const view = await CuratedViewService.create(owner, createInput());
      expect(view.sourcePortalId).toBeNull();
    });
  });

  describe("listEntities", () => {
    const page = { limit: 25, offset: 0 };

    it("lists the org's readable entities with their column keys", async () => {
      const r = await CuratedViewService.listEntities(owner, page);
      expect(r.total).toBe(1);
      const [entity] = r.entities;
      expect(entity).toMatchObject({
        connectorEntityId: target.connectorEntityId,
        key: "contacts",
        label: "Contacts",
      });
      expect(entity.connectorInstance?.id).toEqual(expect.any(String));
      expect(entity.columns.map((c) => c.key).sort()).toEqual(
        expect.arrayContaining(["age", "email"])
      );
      expect(entity.columns.find((c) => c.key === "age")).toEqual({
        key: "age",
        label: "Age",
        type: "number",
      });
      // Another org's entity is never listed.
      expect(
        r.entities.some(
          (e) => e.connectorEntityId === foreign.connectorEntityId
        )
      ).toBe(false);
    });

    it("matches search on key or label", async () => {
      expect(
        (
          await CuratedViewService.listEntities(owner, {
            ...page,
            search: "CONT",
          })
        ).total
      ).toBe(1);
      expect(
        (
          await CuratedViewService.listEntities(owner, {
            ...page,
            search: "zzz",
          })
        ).total
      ).toBe(0);
    });

    it("lists only entities a member can read", async () => {
      // The fixture entity is system-created, which members read; make it
      // the owner's so the member needs a grant.
      await db
        .update(schema.connectorEntities)
        .set({ createdBy: target.ownerUserId })
        .where(eq(schema.connectorEntities.id, target.connectorEntityId));
      const member: PermissionContext = {
        userId: generateId(),
        organizationId: target.orgId,
        roles: ["member"],
      };
      expect(
        (await CuratedViewService.listEntities(member, page)).entities
      ).toEqual([]);

      await db.insert(schema.permissionGrants).values({
        id: generateId(),
        organizationId: target.orgId,
        principalType: "user",
        principalId: member.userId,
        effect: "allow",
        verb: "read",
        resourceType: "entity",
        resourceId: target.connectorEntityId,
        condition: null,
        conditionParam: null,
        created: Date.now(),
        createdBy: target.ownerUserId,
      } as never);
      const r = await CuratedViewService.listEntities(member, page);
      expect(r.entities.map((e) => e.connectorEntityId)).toEqual([
        target.connectorEntityId,
      ]);
    });
  });
});
