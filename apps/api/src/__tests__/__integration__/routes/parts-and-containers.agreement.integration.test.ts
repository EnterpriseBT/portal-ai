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
import { ToolService } from "../../../services/tools.service.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import {
  allowForUser,
  attachCuratedView,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";

/**
 * #829: objects and parts. Records and field mappings are parts of their
 * entity, with no permission of their own: the entity's governs them. An
 * entity is contained in its connector instance, so creating or deleting one
 * needs write on the instance; editing it needs only its own write. For each
 * state of the entity (or instance), as a plain member:
 * - unreadable (another member's): 404 (the object's code), nothing written;
 * - read-only (system-owned, which members read): 403 PERMISSION_DENIED;
 * - writable (the member's own): the write succeeds.
 * Parts are created by **someone else** (the owner), so only the entity
 * decides; GET `capabilities` agree with what the routes do.
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

describe("objects and parts (#829)", () => {
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

  /** #829: a mapping on `a` and its counterpart on `b`, referencing each
   *  other, so deleting the first clears the second's back-reference. */
  async function linkedMappings(a: string, b: string) {
    const keyOf = async (id: string) =>
      (
        await db
          .select({ key: schema.connectorEntities.key })
          .from(schema.connectorEntities)
          .where(eq(schema.connectorEntities.id, id))
      )[0].key;
    const [aKey, bKey] = [await keyOf(a), await keyOf(b)];
    const onA = await mapping(a, fx.memberId);
    const onB = await mapping(b, SYSTEM);
    const nk = async (id: string) =>
      (
        await db
          .select({ nk: schema.fieldMappings.normalizedKey })
          .from(schema.fieldMappings)
          .where(eq(schema.fieldMappings.id, id))
      )[0].nk;
    const [aNk, bNk] = [await nk(onA), await nk(onB)];
    await db
      .update(schema.fieldMappings)
      .set({ refEntityKey: bKey, refNormalizedKey: bNk } as never)
      .where(eq(schema.fieldMappings.id, onA));
    await db
      .update(schema.fieldMappings)
      .set({ refEntityKey: aKey, refNormalizedKey: aNk } as never)
      .where(eq(schema.fieldMappings.id, onB));
    return { onA, onB };
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

  /** A GET's capabilities agree with the routes; a GET that 404s offers
   *  nothing. `expected` is what a readable object's capabilities are. */
  const expectCapabilities = (
    res: request.Response,
    state: ParentState,
    pick: (body: Record<string, unknown>) => unknown,
    expected: { read: boolean; write: boolean; delete: boolean } = {
      read: true,
      write: state === "writable",
      delete: state === "writable",
    }
  ) => {
    if (res.status === 404) {
      expect(state).toBe("unreadable");
      return;
    }
    expect(res.status).toBe(200);
    const caps = (pick(res.body.payload) as { capabilities: unknown })
      .capabilities;
    expect(caps).toEqual(expected);
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
    it("read, create, update, delete and capabilities follow the entity", async () => {
      const entityId = await entity(parentOwner(state));
      const existing = await mapping(entityId, fx.ownerId);
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
      if (state === "unreadable") {
        expect(caps.body.code).toBe(ApiCode.FIELD_MAPPING_NOT_FOUND);
      }
      const list = await request(app).get(
        `/api/field-mappings?connectorEntityId=${entityId}`
      );
      expect(
        (list.body.payload.fieldMappings as { id: string }[]).map((m) => m.id)
      ).toEqual(state === "unreadable" ? [] : [existing]);

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
      expectOutcome(update, state, ApiCode.FIELD_MAPPING_NOT_FOUND);

      if (state !== "writable") {
        expect(await live()).toHaveLength(1);
        expect((await live())[0].sourceField).toBe("name");
      }

      const remove = await request(app).delete(
        `/api/field-mappings/${existing}`
      );
      expectOutcome(remove, state, ApiCode.FIELD_MAPPING_NOT_FOUND);
      expect((await live()).some((m) => m.id === existing)).toBe(
        state !== "writable"
      );
    });
  });

  describe.each(STATES)("record, entity %s", (state) => {
    it("read, create, update, delete and capabilities follow the entity", async () => {
      const entityId = await entity(parentOwner(state));
      const existing = await record(entityId, fx.ownerId);
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
      const list = await request(app).get(records);
      if (state === "unreadable") {
        expect(list.status).toBe(404);
      } else {
        expect(
          (list.body.payload.records as { id: string }[]).map((r) => r.id)
        ).toEqual([existing]);
        const count = await request(app).get(`${records}/count`);
        expect(count.body.payload.total).toBe(1);
      }

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

  describe.each(["readOnly", "writable"] as const)(
    "field mapping delete, counterpart's entity %s",
    (state) => {
      it("needs write on the counterpart's entity too", async () => {
        const a = await entity(fx.memberId);
        const b = await entity(parentOwner(state));
        const { onA, onB } = await linkedMappings(a, b);
        const res = await request(app).delete(`/api/field-mappings/${onA}`);
        expectOutcome(res, state, ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
        const [counterpart] = await db
          .select()
          .from(schema.fieldMappings)
          .where(eq(schema.fieldMappings.id, onB));
        expect(counterpart.refEntityKey === null).toBe(state === "writable");
      });
    }
  );

  // #832: members read the system-seeded column-definition catalog, and a
  // field mapping's column definition is a reference that needs read.
  describe("column definitions (#832)", () => {
    async function ownerColumnDefinition() {
      const id = generateId();
      await db.insert(schema.columnDefinitions).values({
        id,
        organizationId: fx.orgId,
        key: `owner_col_${suffix()}`,
        label: "Owner col",
        type: "string",
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        ...base(fx.ownerId),
      } as never);
      return id;
    }

    it("a member lists and reads system definitions, not an admin-created one", async () => {
      const ownerCol = await ownerColumnDefinition();
      const list = await request(app).get("/api/column-definitions?limit=100");
      expect(list.status).toBe(200);
      const ids = (list.body.payload.columnDefinitions as { id: string }[]).map(
        (d) => d.id
      );
      expect(ids).toContain(colDefId);
      expect(ids).not.toContain(ownerCol);
      expect(
        (await request(app).get(`/api/column-definitions/${colDefId}`)).status
      ).toBe(200);
      const hidden = await request(app).get(
        `/api/column-definitions/${ownerCol}`
      );
      expect([hidden.status, hidden.body.code]).toEqual([
        404,
        ApiCode.COLUMN_DEFINITION_NOT_FOUND,
      ]);
    });

    it("creating a mapping needs read on its column definition", async () => {
      const entityId = await entity(fx.memberId);
      const ownerCol = await ownerColumnDefinition();
      const body = (columnDefinitionId: string) => ({
        connectorEntityId: entityId,
        columnDefinitionId,
        sourceField: "added",
        normalizedKey: `added_${suffix()}`,
      });
      const refused = await request(app)
        .post("/api/field-mappings")
        .send(body(ownerCol));
      expect([refused.status, refused.body.code]).toEqual([
        404,
        ApiCode.COLUMN_DEFINITION_NOT_FOUND,
      ]);
      const created = await request(app)
        .post("/api/field-mappings")
        .send(body(otherColDefId));
      expect(created.status).toBe(201);
    });

    it("switching a mapping's column definition needs read on the new one; resending it doesn't", async () => {
      const entityId = await entity(fx.memberId);
      const existing = await mapping(entityId, fx.memberId);
      const ownerCol = await ownerColumnDefinition();
      const switched = await request(app)
        .patch(`/api/field-mappings/${existing}`)
        .send({ sourceField: "name", columnDefinitionId: ownerCol });
      expect([switched.status, switched.body.code]).toEqual([
        404,
        ApiCode.COLUMN_DEFINITION_NOT_FOUND,
      ]);
      const resent = await request(app)
        .patch(`/api/field-mappings/${existing}`)
        .send({ sourceField: "renamed", columnDefinitionId: colDefId });
      expect(resent.status).toBe(200);
    });

    it("an owner-created stored column definition doesn't block a member's edit that resends it", async () => {
      // The definition was readable when it was set; resending it is no change.
      const entityId = await entity(fx.memberId);
      const existing = await mapping(entityId, fx.memberId);
      const ownerCol = await ownerColumnDefinition();
      await db
        .update(schema.fieldMappings)
        .set({ columnDefinitionId: ownerCol } as never)
        .where(eq(schema.fieldMappings.id, existing));
      const resent = await request(app)
        .patch(`/api/field-mappings/${existing}`)
        .send({ sourceField: "renamed", columnDefinitionId: ownerCol });
      expect(resent.status).toBe(200);
    });
  });

  describe.each(["unreadable", "readOnly"] as const)(
    "entity-wide record writes, entity %s",
    (state) => {
      it("import, revalidate and clear need write on the entity", async () => {
        const entityId = await entity(parentOwner(state));
        await record(entityId, fx.ownerId);
        const records = `/api/connector-entities/${entityId}/records`;
        expectOutcome(
          await request(app).post(`${records}/import`).send({ records: [] }),
          state,
          ApiCode.CONNECTOR_ENTITY_NOT_FOUND
        );
        expectOutcome(
          await request(app).post(`${records}/revalidate`),
          state,
          ApiCode.CONNECTOR_ENTITY_NOT_FOUND
        );
        expectOutcome(
          await request(app).delete(records),
          state,
          ApiCode.CONNECTOR_ENTITY_NOT_FOUND
        );
      });
    }
  );

  describe.each(STATES)("entity, connector %s", (state) => {
    it("create and delete follow the connector; update and write don't", async () => {
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
      expectCapabilities(caps, state, (p) => p.connectorEntity, {
        read: true,
        write: true,
        delete: state === "writable",
      });

      const create = await request(app)
        .post("/api/connector-entities")
        .send({
          connectorInstanceId: instanceId,
          key: `added_${suffix()}`,
          label: "Added",
        });
      expectOutcome(create, state, ApiCode.CONNECTOR_INSTANCE_NOT_FOUND);

      // Editing the member's own entity needs only its own write.
      const update = await request(app)
        .patch(`/api/connector-entities/${existing}`)
        .send({ label: "Changed" });
      expect(update.status).toBe(200);

      if (state !== "writable") {
        expect(await live()).toHaveLength(1);
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

  // ── The agent tools give the same answers (#829) ────────────────────

  describe("agent tools", () => {
    let stationId: string;
    const tierCreatedBy = "CHILD_WRITE_PARENT_TEST";

    beforeEach(async () => {
      const slug = `cwp-${suffix()}`;
      await db.insert(schema.tiers).values({
        id: generateId(),
        ...base(tierCreatedBy),
        slug,
        displayName: "Child write parent test",
        builtinToolpacks: ["entity_management"],
      } as never);
      await db
        .update(schema.organizations)
        .set({ tier: slug })
        .where(eq(schema.organizations.id, fx.orgId));
      stationId = generateId();
      await db.insert(schema.stations).values({
        id: stationId,
        organizationId: fx.orgId,
        name: "Agent station",
        description: null,
        ...base(fx.ownerId),
      } as never);
      await db.insert(schema.stationToolpacks).values({
        id: generateId(),
        stationId,
        builtinSlug: "entity_management",
        organizationToolpackId: null,
        ...base(fx.ownerId),
      } as never);
    });

    afterEach(async () => {
      await teardownOrg(db);
      await db
        .delete(schema.tiers)
        .where(eq(schema.tiers.createdBy, tierCreatedBy));
    });

    /** Attach the connector (and a view on each entity) to the station. */
    const reach = async (instanceId: string, entityIds: string[]) => {
      await db.insert(schema.stationInstances).values({
        id: generateId(),
        stationId,
        connectorInstanceId: instanceId,
        ...base(fx.ownerId),
      } as never);
      for (const connectorEntityId of entityIds) {
        await attachCuratedView(db as never, {
          stationId,
          organizationId: fx.orgId,
          connectorEntityId,
          key: `view_${suffix()}`,
          label: "View",
          createdBy: fx.ownerId,
        });
      }
    };

    const memberTool = async (name: string) => {
      const tools = await ToolService.buildAnalyticsTools(
        fx.orgId,
        stationId,
        fx.memberId,
        generateId()
      );
      const t = tools[name] as
        | {
            execute: (
              input: unknown,
              opts: unknown
            ) => Promise<Record<string, unknown>>;
          }
        | undefined;
      expect([name, typeof t?.execute]).toEqual([name, "function"]);
      return (input: unknown) =>
        t!.execute(input, {
          toolCallId: "t",
          messages: [],
          abortSignal: new AbortController().signal,
        });
    };

    /** A refused state's code; a writable state runs the tool. */
    const expectTool = (
      result: Record<string, unknown>,
      state: ParentState
    ) => {
      if (state === "unreadable") {
        expect(result).toHaveProperty("error.code", "TOOL_TARGET_NOT_FOUND");
      } else if (state === "readOnly") {
        expect(result).toHaveProperty("error.code", "TOOL_PERMISSION_DENIED");
      } else {
        expect([JSON.stringify(result), result.success]).toEqual([
          JSON.stringify(result),
          true,
        ]);
      }
    };

    const instanceOf = async (entityId: string) =>
      (
        await db
          .select()
          .from(schema.connectorEntities)
          .where(eq(schema.connectorEntities.id, entityId))
      )[0].connectorInstanceId;

    describe.each(STATES)("field mapping tools, entity %s", (state) => {
      it("create, update and delete of anyone's mapping follow the entity", async () => {
        const entityId = await entity(parentOwner(state));
        const existing = await mapping(entityId, fx.ownerId);
        await reach(await instanceOf(entityId), [entityId]);
        const count = async () =>
          (
            await db
              .select()
              .from(schema.fieldMappings)
              .where(
                and(
                  eq(schema.fieldMappings.connectorEntityId, entityId),
                  isNull(schema.fieldMappings.deleted)
                )
              )
          ).length;

        expectTool(
          await (
            await memberTool("field_mapping_create")
          )({
            items: [
              {
                connectorEntityId: entityId,
                columnDefinitionId: otherColDefId,
                sourceField: "added",
                normalizedKey: `added_${suffix()}`,
              },
            ],
          }),
          state
        );
        if (state !== "writable") expect(await count()).toBe(1);

        expectTool(
          await (
            await memberTool("field_mapping_update")
          )({ items: [{ fieldMappingId: existing, sourceField: "changed" }] }),
          state
        );
        expectTool(
          await (
            await memberTool("field_mapping_delete")
          )({ items: [{ fieldMappingId: existing }] }),
          state
        );
        if (state !== "writable") expect(await count()).toBe(1);
      });
    });

    describe.each(STATES)("record tools, entity %s", (state) => {
      it("create, update and delete of anyone's record follow the entity", async () => {
        const entityId = await entity(parentOwner(state));
        // The record tools refuse an entity with no mappings.
        await mapping(entityId, fx.ownerId);
        wideTableStatementCache.clear();
        await wideTableReconcilerService.reconcileEntity(
          entityId,
          db as unknown as DbClient
        );
        const existing = await record(entityId, fx.ownerId);
        await reach(await instanceOf(entityId), [entityId]);
        const count = async () =>
          (
            await db
              .select()
              .from(schema.entityRecords)
              .where(
                and(
                  eq(schema.entityRecords.connectorEntityId, entityId),
                  isNull(schema.entityRecords.deleted)
                )
              )
          ).length;

        expectTool(
          await (
            await memberTool("entity_record_create")
          )({ items: [{ connectorEntityId: entityId, data: {} }] }),
          state
        );
        if (state !== "writable") expect(await count()).toBe(1);

        // The record's entity comes from its stored row: naming it here
        // changes nothing.
        expectTool(
          await (
            await memberTool("entity_record_update")
          )({
            items: [
              {
                connectorEntityId: entityId,
                entityRecordId: existing,
                data: {},
              },
            ],
          }),
          state
        );
        expectTool(
          await (
            await memberTool("entity_record_delete")
          )({
            items: [{ connectorEntityId: entityId, entityRecordId: existing }],
          }),
          state
        );
        if (state !== "writable") expect(await count()).toBe(1);
      });
    });

    describe.each(STATES)("entity tools, connector %s", (state) => {
      it("create and delete follow the connector; update needs only the entity", async () => {
        const instanceId = await instance(parentOwner(state));
        const existing = await entity(fx.memberId, instanceId);
        await reach(instanceId, [existing]);
        const count = async () =>
          (
            await db
              .select()
              .from(schema.connectorEntities)
              .where(
                and(
                  eq(schema.connectorEntities.connectorInstanceId, instanceId),
                  isNull(schema.connectorEntities.deleted)
                )
              )
          ).length;

        expectTool(
          await (
            await memberTool("connector_entity_create")
          )({
            items: [
              {
                connectorInstanceId: instanceId,
                key: `added_${suffix()}`,
                label: "Added",
              },
            ],
          }),
          state
        );
        if (state !== "writable") expect(await count()).toBe(1);

        // The member's own entity: editing it needs only its own write.
        expectTool(
          await (
            await memberTool("connector_entity_update")
          )({ items: [{ connectorEntityId: existing, label: "Changed" }] }),
          "writable"
        );
        expectTool(
          await (
            await memberTool("connector_entity_delete")
          )({ items: [{ connectorEntityId: existing }] }),
          state
        );
        if (state !== "writable") expect(await count()).toBe(1);
      });
    });

    it("#832: field_mapping_create needs read on each item's column definition", async () => {
      const entityId = await entity(fx.memberId);
      await reach(await instanceOf(entityId), [entityId]);
      const ownerCol = generateId();
      await db.insert(schema.columnDefinitions).values({
        id: ownerCol,
        organizationId: fx.orgId,
        key: `owner_col_${suffix()}`,
        label: "Owner col",
        type: "string",
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        ...base(fx.ownerId),
      } as never);
      const result = await (
        await memberTool("field_mapping_create")
      )({
        items: [
          {
            connectorEntityId: entityId,
            columnDefinitionId: ownerCol,
            sourceField: "added",
            normalizedKey: `added_${suffix()}`,
          },
        ],
      });
      expect(result).toHaveProperty("error.code", "TOOL_TARGET_NOT_FOUND");
      const mappings = await db
        .select()
        .from(schema.fieldMappings)
        .where(
          and(
            eq(schema.fieldMappings.connectorEntityId, entityId),
            eq(schema.fieldMappings.columnDefinitionId, ownerCol)
          )
        );
      expect(mappings).toHaveLength(0);
    });

    it("field_mapping_delete needs write on the counterpart's entity too", async () => {
      const a = await entity(fx.memberId);
      const b = await entity(SYSTEM);
      const { onA } = await linkedMappings(a, b);
      await reach(await instanceOf(a), [a]);
      const result = await (
        await memberTool("field_mapping_delete")
      )({ items: [{ fieldMappingId: onA }] });
      expect(result).toHaveProperty("error.code", "TOOL_PERMISSION_DENIED");
      const [still] = await db
        .select()
        .from(schema.fieldMappings)
        .where(eq(schema.fieldMappings.id, onA));
      expect(still.deleted).toBeNull();
    });

    describe("transform_entity_records checks every target and its source", () => {
      const transform = (source: string, targets: string[]) => ({
        sourceConnectorEntityId: source,
        keyField: "c_id",
        expression: {
          writes: targets.map((targetConnectorEntityId) => ({
            targetConnectorEntityId,
          })),
        },
      });
      const jobCount = async () =>
        (
          await db
            .select()
            .from(schema.jobs)
            .where(eq(schema.jobs.organizationId, fx.orgId))
        ).length;

      it("a second target in another org is not found, and nothing is enqueued", async () => {
        const source = await entity(fx.memberId);
        const first = await entity(fx.memberId);
        const otherInstance = generateId();
        await db.insert(schema.connectorInstances).values({
          id: otherInstance,
          connectorDefinitionId: definitionId,
          organizationId: fx.otherOrgId,
          name: "Theirs",
          status: "active",
          config: null,
          credentials: null,
          lastSyncAt: null,
          lastErrorMessage: null,
          enabledCapabilityFlags: { read: true, write: true },
          ...base(fx.otherOwnerId),
        } as never);
        const theirs = generateId();
        await db.insert(schema.connectorEntities).values({
          id: theirs,
          organizationId: fx.otherOrgId,
          connectorInstanceId: otherInstance,
          key: `theirs_${suffix()}`,
          label: "Theirs",
          ...base(fx.otherOwnerId),
        } as never);
        await reach(await instanceOf(source), [source]);
        await reach(await instanceOf(first), [first]);

        const result = await (
          await memberTool("transform_entity_records")
        )(transform(source, [first, theirs]));
        expect(result).toHaveProperty("error.code", "TOOL_TARGET_NOT_FOUND");
        expect(await jobCount()).toBe(0);
      });

      it("a read-only second target is denied, and nothing is enqueued", async () => {
        const source = await entity(fx.memberId);
        const first = await entity(fx.memberId);
        const systemTarget = await entity(SYSTEM);
        for (const e of [source, first, systemTarget])
          await reach(await instanceOf(e), [e]);

        const result = await (
          await memberTool("transform_entity_records")
        )(transform(source, [first, systemTarget]));
        expect(result).toHaveProperty("error.code", "TOOL_PERMISSION_DENIED");
        expect(await jobCount()).toBe(0);
      });
    });
  });
});
