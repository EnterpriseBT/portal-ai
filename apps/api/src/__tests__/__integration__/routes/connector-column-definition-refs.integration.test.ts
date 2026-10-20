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
import { and, eq, isNull } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { SystemUtilities } from "../../../utils/system.util.js";
import {
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";

/**
 * #834: the REST-API connector's endpoint save maps each draft column to a
 * column definition. An adopted one is a reference, so the caller must read
 * it (#832); a key match reuses only one the caller reads; a fresh one needs
 * the column-definition create rule. Every column is decided before the
 * entity is written, so a refusal leaves nothing behind. A plain member,
 * on their own REST-API connector, reads system definitions but not one
 * the owner created, and can't create one.
 */

const OWNER_SUB = "auth0|ccdr-owner";
const MEMBER_SUB = "auth0|ccdr-member";
const OTHER_SUB = "auth0|ccdr-other-owner";
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

describe("REST-API endpoint save: column-definition references (#834)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let fx: TenancyFixture;
  let instanceId: string;
  /** System-created: the member reads it. */
  let systemColId: string;
  let systemColKey: string;
  /** Owner-created: the member can't read it. */
  let ownerColId: string;
  let ownerColKey: string;

  async function columnDefinition(createdBy: string, key: string) {
    const id = generateId();
    await db.insert(schema.columnDefinitions).values({
      id,
      organizationId: fx.orgId,
      key,
      label: key,
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      system: false,
      ...base(createdBy),
    } as never);
    return id;
  }

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    fx = await seedTenancyFixture(db, {
      owner: OWNER_SUB,
      member: MEMBER_SUB,
      otherOwner: OTHER_SUB,
    });

    const definitionId = generateId();
    await db.insert(schema.connectorDefinitions).values({
      id: definitionId,
      slug: "rest-api",
      display: "REST API",
      category: "api",
      authType: "none",
      configSchema: null,
      capabilityFlags: { sync: true, read: true },
      isActive: true,
      version: "0.1.0",
      iconUrl: null,
      ...base("SYSTEM_TEST"),
    } as never);
    instanceId = generateId();
    await db.insert(schema.connectorInstances).values({
      id: instanceId,
      connectorDefinitionId: definitionId,
      organizationId: fx.orgId,
      name: "Member REST",
      status: "active",
      config: { baseUrl: "https://api.example.com", auth: { mode: "none" } },
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: null,
      ...base(fx.memberId),
    } as never);

    systemColKey = `sys_${suffix()}`;
    systemColId = await columnDefinition(
      SystemUtilities.id.system,
      systemColKey
    );
    ownerColKey = `own_${suffix()}`;
    ownerColId = await columnDefinition(fx.ownerId, ownerColKey);
    currentSub = MEMBER_SUB;
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  const save = (
    key: string,
    columns: Array<{ normalizedKey: string; columnDefinitionId?: string }>
  ) =>
    request(app)
      .post(`/api/connector-instances/${instanceId}/api-endpoints`)
      .send({
        key,
        label: key,
        config: {
          path: `/${key}`,
          method: "GET",
          recordsPath: "",
          idField: "id",
          pagination: { strategy: "none" },
        },
        columns: columns.map((c) => ({
          sourceField: c.normalizedKey,
          normalizedKey: c.normalizedKey,
          type: "string",
          required: false,
          ...(c.columnDefinitionId
            ? { columnDefinitionId: c.columnDefinitionId }
            : {}),
        })),
      });

  const entityExists = async (key: string) =>
    (
      await db
        .select()
        .from(schema.connectorEntities)
        .where(
          and(
            eq(schema.connectorEntities.organizationId, fx.orgId),
            eq(schema.connectorEntities.key, key),
            isNull(schema.connectorEntities.deleted)
          )
        )
    ).length > 0;

  const definitionsWithKey = async (key: string) =>
    db
      .select()
      .from(schema.columnDefinitions)
      .where(
        and(
          eq(schema.columnDefinitions.organizationId, fx.orgId),
          eq(schema.columnDefinitions.key, key),
          isNull(schema.columnDefinitions.deleted)
        )
      );

  const mappedDefinitions = async (key: string) => {
    const [entity] = await db
      .select()
      .from(schema.connectorEntities)
      .where(
        and(
          eq(schema.connectorEntities.organizationId, fx.orgId),
          eq(schema.connectorEntities.key, key)
        )
      );
    const rows = await db
      .select()
      .from(schema.fieldMappings)
      .where(eq(schema.fieldMappings.connectorEntityId, entity.id));
    return rows.map((r) => r.columnDefinitionId);
  };

  it("an adopted column definition the caller can't read → 404, nothing written", async () => {
    const key = `ep_${suffix()}`;
    const res = await save(key, [
      { normalizedKey: "email", columnDefinitionId: ownerColId },
    ]);
    expect([res.status, res.body.code]).toEqual([
      404,
      ApiCode.COLUMN_DEFINITION_NOT_FOUND,
    ]);
    expect(await entityExists(key)).toBe(false);
  });

  it("an adopted column definition from another org → 404, nothing written", async () => {
    const foreign = generateId();
    await db.insert(schema.columnDefinitions).values({
      id: foreign,
      organizationId: fx.otherOrgId,
      key: `foreign_${suffix()}`,
      label: "Foreign",
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      system: false,
      ...base(SystemUtilities.id.system),
    } as never);
    const key = `ep_${suffix()}`;
    const res = await save(key, [
      { normalizedKey: "email", columnDefinitionId: foreign },
    ]);
    expect([res.status, res.body.code]).toEqual([
      404,
      ApiCode.COLUMN_DEFINITION_NOT_FOUND,
    ]);
    expect(await entityExists(key)).toBe(false);
  });

  it("an adopted readable column definition is mapped", async () => {
    const key = `ep_${suffix()}`;
    const res = await save(key, [
      { normalizedKey: "email", columnDefinitionId: systemColId },
    ]);
    expect([res.status, JSON.stringify(res.body)]).toEqual([
      201,
      JSON.stringify(res.body),
    ]);
    expect(await mappedDefinitions(key)).toEqual([systemColId]);
  });

  it("a key match reuses a readable column definition", async () => {
    const key = `ep_${suffix()}`;
    const res = await save(key, [{ normalizedKey: systemColKey }]);
    expect(res.status).toBe(201);
    expect(await mappedDefinitions(key)).toEqual([systemColId]);
  });

  it("a key match on an unreadable column definition isn't reused: creating one needs the create rule → 403", async () => {
    const key = `ep_${suffix()}`;
    const res = await save(key, [{ normalizedKey: ownerColKey }]);
    expect([res.status, res.body.code]).toEqual([
      403,
      ApiCode.PERMISSION_DENIED,
    ]);
    expect(await entityExists(key)).toBe(false);
    expect(await definitionsWithKey(ownerColKey)).toHaveLength(1);
  });

  it("a new column without the column-definition create rule → 403, no entity and no definition", async () => {
    const key = `ep_${suffix()}`;
    const fresh = `fresh_${suffix()}`;
    const res = await save(key, [
      { normalizedKey: systemColKey },
      { normalizedKey: fresh },
    ]);
    expect([res.status, res.body.code]).toEqual([
      403,
      ApiCode.PERMISSION_DENIED,
    ]);
    expect(await entityExists(key)).toBe(false);
    expect(await definitionsWithKey(fresh)).toHaveLength(0);
  });

  it("the owner, who holds the create rule, gets the new column definition created and mapped", async () => {
    currentSub = OWNER_SUB;
    const key = `ep_${suffix()}`;
    const fresh = `fresh_${suffix()}`;
    const res = await save(key, [{ normalizedKey: fresh }]);
    expect([res.status, JSON.stringify(res.body)]).toEqual([
      201,
      JSON.stringify(res.body),
    ]);
    const created = await definitionsWithKey(fresh);
    expect(created).toHaveLength(1);
    expect(await mappedDefinitions(key)).toEqual([created[0].id]);
  });
});
