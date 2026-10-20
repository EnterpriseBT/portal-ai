import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, isNull, sql } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { wideTableStatementCache } from "../../../services/wide-table-statement.cache.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  allowForUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";

/**
 * #829: a child write needs write on its parent. Read means read only. For
 * each child type (field mapping and record under an entity, entity under a
 * connector instance) and each state of the parent, as a plain member:
 * - unreadable (another member's): 404 with the parent's code, nothing written;
 * - read-only (system-owned, which members read): 403 PERMISSION_DENIED;
 * - writable (the member's own): the write succeeds.
 * A create, an update and a delete of the member's own child all follow the
 * parent, and the child's GET `capabilities` agree with what the routes do.
 */

const OWNER_SUB = "auth0|cwp-owner";
const MEMBER_SUB = "auth0|cwp-member";
const OTHER_SUB = "auth0|cwp-other-owner";
let currentSub = OWNER_SUB;

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: currentSub } } as never;
    next();
  },
}));
jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

const { app } = await import("../../../app.js");

const SYSTEM = "SYSTEM_TEST";
const now = Date.now();
const base = (createdBy: string) => ({
  created: now,
  createdBy,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});
const suffix = () => generateId().replace(/-/g, "").slice(0, 8);

type ParentState = "unreadable" | "readOnly" | "writable";
const STATES: ParentState[] = ["unreadable", "readOnly", "writable"];

describe("child writes require write on the parent (#829)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let fx: TenancyFixture;
  let definitionId: string;
  let colDefId: string;
  /** A second column, for creates (one mapping per column per entity). */
  let otherColDefId: string;

  /** Who creates a parent in each state, as the member sees it. */
  const parentOwner = (state: ParentState) =>
    state === "unreadable"
      ? fx.ownerId
      : state === "readOnly"
        ? SYSTEM
        : fx.memberId;

  async function instance(createdBy: string) {
    const id = generateId();
    await db.insert(schema.connectorInstances).values({
      id,
      connectorDefinitionId: definitionId,
      organizationId: fx.orgId,
      name: "Instance",
      status: "active",
      config: null,
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true },
      ...base(createdBy),
    } as never);
    return id;
  }

  async function entity(createdBy: string, instanceId?: string) {
    const id = generateId();
    await db.insert(schema.connectorEntities).values({
      id,
      organizationId: fx.orgId,
      connectorInstanceId: instanceId ?? (await instance(createdBy)),
      key: `entity_${suffix()}`,
      label: "Entity",
      ...base(createdBy),
    } as never);
    wideTableStatementCache.clear();
    await wideTableReconcilerService.reconcileEntity(
      id,
      db as unknown as DbClient
    );
    return id;
  }

  async function mapping(entityId: string, createdBy: string) {
    const id = generateId();
    await db.insert(schema.fieldMappings).values({
      id,
      organizationId: fx.orgId,
      connectorEntityId: entityId,
      columnDefinitionId: colDefId,
      sourceField: "name",
      isPrimaryKey: false,
      normalizedKey: `nk_${suffix()}`,
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      ...base(createdBy),
    } as never);
    return id;
  }

  async function record(entityId: string, createdBy: string) {
    const id = generateId();
    await db.insert(schema.entityRecords).values({
      ...base(createdBy),
      id,
      organizationId: fx.orgId,
      connectorEntityId: entityId,
      sourceId: `src-${id}`,
      isValid: true,
      validationErrors: null,
      normalizedData: {},
      syncedAt: now,
      data: {},
      checksum: `checksum-${id}`,
      origin: "manual",
    } as never);
    // Reads join the entity's wide table.
    await db.execute(
      sql`INSERT INTO ${sql.raw(`"er__${entityId}"`)} ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id") VALUES (${id}, ${fx.orgId}, ${now}, true, ${`src-${id}`})`
    );
    return id;
  }

  /** The status a parent in `state` gives a write, and its error code. */
  const expectOutcome = (
    res: request.Response,
    state: ParentState,
    notFoundCode: ApiCode
  ) => {
    if (state === "unreadable") {
      expect([res.status, res.body.code]).toEqual([404, notFoundCode]);
    } else if (state === "readOnly") {
      expect([res.status, res.body.code]).toEqual([
        403,
        ApiCode.PERMISSION_DENIED,
      ]);
    } else {
      expect([200, 201]).toContain(res.status);
    }
  };

  /** A child's GET capabilities agree with the routes: write/delete only
   *  under a writable parent; a GET that 404s offers nothing. */
  const expectCapabilities = (
    res: request.Response,
    state: ParentState,
    pick: (body: Record<string, unknown>) => unknown
  ) => {
    if (res.status === 404) {
      expect(state).toBe("unreadable");
      return;
    }
    expect(res.status).toBe(200);
    const caps = (pick(res.body.payload) as { capabilities: unknown })
      .capabilities;
    const writable = state === "writable";
    expect(caps).toEqual({ read: true, write: writable, delete: writable });
  };

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 2 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    fx = await seedTenancyFixture(db, {
      owner: OWNER_SUB,
      member: MEMBER_SUB,
      otherOwner: OTHER_SUB,
    });
    definitionId = generateId();
    await db.insert(schema.connectorDefinitions).values({
      id: definitionId,
      slug: `slug-${suffix()}`,
      display: "Test Connector",
      category: "crm",
      authType: "oauth2",
      configSchema: null,
      capabilityFlags: { sync: true, read: true, write: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      ...base(SYSTEM),
    } as never);
    colDefId = generateId();
    await db.insert(schema.columnDefinitions).values({
      id: colDefId,
      organizationId: fx.orgId,
      key: `col_${suffix()}`,
      label: "Col",
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      ...base(SYSTEM),
    } as never);
    otherColDefId = generateId();
    await db.insert(schema.columnDefinitions).values({
      id: otherColDefId,
      organizationId: fx.orgId,
      key: `col_${suffix()}`,
      label: "Other col",
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      ...base(SYSTEM),
    } as never);
    currentSub = MEMBER_SUB;
  });

  afterEach(async () => {
    await connection.end();
  });

  describe.each(STATES)("field mapping, entity %s", (state) => {
    it("create, update, delete and capabilities follow the entity", async () => {
      const entityId = await entity(parentOwner(state));
      const existing = await mapping(entityId, fx.memberId);
      const live = () =>
        db
          .select()
          .from(schema.fieldMappings)
          .where(
            and(
              eq(schema.fieldMappings.connectorEntityId, entityId),
              isNull(schema.fieldMappings.deleted)
            )
          );

      const caps = await request(app).get(`/api/field-mappings/${existing}`);
      expectCapabilities(caps, state, (p) => p.fieldMapping);

      const create = await request(app)
        .post("/api/field-mappings")
        .send({
          connectorEntityId: entityId,
          columnDefinitionId: otherColDefId,
          sourceField: "added",
          normalizedKey: `added_${suffix()}`,
        });
      expectOutcome(create, state, ApiCode.CONNECTOR_ENTITY_NOT_FOUND);

      const update = await request(app)
        .patch(`/api/field-mappings/${existing}`)
        .send({ sourceField: "changed", columnDefinitionId: colDefId });
      expectOutcome(update, state, ApiCode.CONNECTOR_ENTITY_NOT_FOUND);

      if (state !== "writable") {
        expect(await live()).toHaveLength(1);
        expect((await live())[0].sourceField).toBe("name");
      }

      const remove = await request(app).delete(
        `/api/field-mappings/${existing}`
      );
      expectOutcome(remove, state, ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
      expect((await live()).some((m) => m.id === existing)).toBe(
        state !== "writable"
      );
    });
  });

  describe.each(STATES)("record, entity %s", (state) => {
    it("create, update, delete and capabilities follow the entity", async () => {
      const entityId = await entity(parentOwner(state));
      const existing = await record(entityId, fx.memberId);
      const live = () =>
        db
          .select()
          .from(schema.entityRecords)
          .where(
            and(
              eq(schema.entityRecords.connectorEntityId, entityId),
              isNull(schema.entityRecords.deleted)
            )
          );
      const records = `/api/connector-entities/${entityId}/records`;

      const caps = await request(app).get(`${records}/${existing}`);
      expectCapabilities(caps, state, (p) => p.record);

      const create = await request(app)
        .post(records)
        .send({ normalizedData: { name: "added" } });
      expectOutcome(create, state, ApiCode.CONNECTOR_ENTITY_NOT_FOUND);

      const update = await request(app)
        .patch(`${records}/${existing}`)
        .send({ data: { name: "changed" } });
      expectOutcome(update, state, ApiCode.CONNECTOR_ENTITY_NOT_FOUND);

      if (state !== "writable") {
        expect(await live()).toHaveLength(1);
        expect((await live())[0].data).toEqual({});
      }

      const remove = await request(app).delete(`${records}/${existing}`);
      expectOutcome(remove, state, ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
      expect((await live()).some((r) => r.id === existing)).toBe(
        state !== "writable"
      );
    });
  });

  describe.each(STATES)("entity, connector %s", (state) => {
    it("create, update, delete and capabilities follow the connector", async () => {
      const instanceId = await instance(parentOwner(state));
      const existing = await entity(fx.memberId, instanceId);
      const live = () =>
        db
          .select()
          .from(schema.connectorEntities)
          .where(
            and(
              eq(schema.connectorEntities.connectorInstanceId, instanceId),
              isNull(schema.connectorEntities.deleted)
            )
          );

      const caps = await request(app).get(
        `/api/connector-entities/${existing}`
      );
      expectCapabilities(caps, state, (p) => p.connectorEntity);

      const create = await request(app)
        .post("/api/connector-entities")
        .send({
          connectorInstanceId: instanceId,
          key: `added_${suffix()}`,
          label: "Added",
        });
      expectOutcome(create, state, ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);

      const update = await request(app)
        .patch(`/api/connector-entities/${existing}`)
        .send({ label: "Changed" });
      expectOutcome(update, state, ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);

      if (state !== "writable") {
        expect(await live()).toHaveLength(1);
        expect((await live())[0].label).toBe("Entity");
      }

      const remove = await request(app).delete(
        `/api/connector-entities/${existing}`
      );
      expectOutcome(remove, state, ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);
      expect((await live()).some((e) => e.id === existing)).toBe(
        state !== "writable"
      );
    });
  });

  describe("referenced entities need read (#829)", () => {
    it("adding a group member with an entity the caller can't read is a 404", async () => {
      // The member may change groups (a granted policy), so only the
      // referenced entity, another member's, is in question.
      for (const verb of ["read", "write"] as const) {
        await allowForUser(db, {
          organizationId: fx.orgId,
          userId: fx.memberId,
          verb,
          resourceType: "entity_group",
        });
      }
      const groupId = generateId();
      await db.insert(schema.entityGroups).values({
        id: groupId,
        organizationId: fx.orgId,
        name: `group-${suffix()}`,
        description: null,
        ...base(fx.ownerId),
      } as never);
      const entityId = await entity(fx.ownerId);
      const fmId = await mapping(entityId, fx.ownerId);

      const res = await request(app)
        .post(`/api/entity-groups/${groupId}/members`)
        .send({ connectorEntityId: entityId, linkFieldMappingId: fmId });
      expect([res.status, res.body.code]).toEqual([
        404,
        ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
      ]);
      const members = await db
        .select()
        .from(schema.entityGroupMembers)
        .where(eq(schema.entityGroupMembers.entityGroupId, groupId));
      expect(members).toHaveLength(0);
    });

    it("creating a curated view on an entity the caller can't read is a 404", async () => {
      await allowForUser(db, {
        organizationId: fx.orgId,
        userId: fx.memberId,
        verb: "write",
        resourceType: "curated_view",
      });
      const entityId = await entity(fx.ownerId);
      const res = await request(app)
        .post("/api/curated-views")
        .send({
          connectorEntityId: entityId,
          key: `view_${suffix()}`,
          label: "View",
        });
      expect([res.status, res.body.code]).toEqual([
        404,
        ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
      ]);
    });
  });
});
