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
 * #834/#838: the REST-API connector's endpoint save maps each draft column
 * onto the existing column definition it names, and never creates one. The
 * definition is a reference, so the caller must read it (#832). Every column
 * is checked before the entity is written, so a refusal leaves nothing
 * behind. A plain member, on their own REST-API connector, reads system
 * definitions but not one the owner created.
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

  it("a column without a column definition → 400 naming it, nothing written", async () => {
    const key = `ep_${suffix()}`;
    const res = await save(key, [{ normalizedKey: systemColKey }]);
    expect([res.status, res.body.code]).toEqual([
      400,
      ApiCode.REST_API_INVALID_CONFIG,
    ]);
    expect(res.body.message).toContain("columns.0.columnDefinitionId");
    expect(await entityExists(key)).toBe(false);
  });

  it("a repeated normalized key → 400 before anything is written", async () => {
    const key = `ep_${suffix()}`;
    const res = await save(key, [
      { normalizedKey: "email", columnDefinitionId: systemColId },
      { normalizedKey: "email", columnDefinitionId: systemColId },
    ]);
    expect([res.status, res.body.code]).toEqual([
      400,
      ApiCode.REST_API_INVALID_CONFIG,
    ]);
    expect(res.body.message).toContain("columns.1.normalizedKey");
    expect(await entityExists(key)).toBe(false);
  });

  it("one unreadable column definition among readable ones → 404, nothing written", async () => {
    const key = `ep_${suffix()}`;
    const res = await save(key, [
      { normalizedKey: "email", columnDefinitionId: systemColId },
      { normalizedKey: "secret", columnDefinitionId: ownerColId },
    ]);
    expect([res.status, res.body.code]).toEqual([
      404,
      ApiCode.COLUMN_DEFINITION_NOT_FOUND,
    ]);
    expect(await entityExists(key)).toBe(false);
  });

  it("the owner's save maps the named definitions and creates no column definition", async () => {
    currentSub = OWNER_SUB;
    const orgDefinitions = async () =>
      (
        await db
          .select()
          .from(schema.columnDefinitions)
          .where(
            and(
              eq(schema.columnDefinitions.organizationId, fx.orgId),
              isNull(schema.columnDefinitions.deleted)
            )
          )
      ).length;
    const before = await orgDefinitions();
    const key = `ep_${suffix()}`;
    const res = await save(key, [
      { normalizedKey: `renamed_${suffix()}`, columnDefinitionId: systemColId },
      { normalizedKey: "secret", columnDefinitionId: ownerColId },
    ]);
    expect([res.status, JSON.stringify(res.body)]).toEqual([
      201,
      JSON.stringify(res.body),
    ]);
    expect((await mappedDefinitions(key)).sort()).toEqual(
      [systemColId, ownerColId].sort()
    );
    expect(await orgDefinitions()).toBe(before);
  });

  describe("layout plan patch, as a member", () => {
    /** The member's own spreadsheet connector with a stored plan binding
     *  the system definition. */
    async function memberPlan() {
      const definitionId = generateId();
      await db.insert(schema.connectorDefinitions).values({
        id: definitionId,
        slug: `file-upload-${suffix()}`,
        display: "File Upload",
        category: "file",
        authType: "none",
        configSchema: {},
        capabilityFlags: { sync: true },
        isActive: true,
        version: "1.0.0",
        iconUrl: null,
        ...base("SYSTEM_TEST"),
      } as never);
      const connectorInstanceId = generateId();
      await db.insert(schema.connectorInstances).values({
        id: connectorInstanceId,
        connectorDefinitionId: definitionId,
        organizationId: fx.orgId,
        name: "Member upload",
        status: "active",
        config: null,
        credentials: null,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags: null,
        ...base(fx.memberId),
      } as never);
      const plan = planBinding(systemColId);
      const planId = generateId();
      await db.insert(schema.connectorInstanceLayoutPlans).values({
        id: planId,
        connectorInstanceId,
        planVersion: plan.planVersion,
        revisionTag: null,
        plan,
        interpretationTrace: null,
        supersededBy: null,
        ...base(fx.memberId),
      } as never);
      return { connectorInstanceId, planId };
    }

    const planBinding = (columnDefinitionId: string) => ({
      planVersion: "1.0.0",
      workbookFingerprint: {
        sheetNames: ["Sheet1"],
        dimensions: { Sheet1: { rows: 2, cols: 1 } },
        anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "email" }],
      },
      regions: [
        {
          id: "r1",
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 1 },
          targetEntityDefinitionId: "contacts",
          headerAxes: ["row"],
          segmentsByAxis: { row: [{ kind: "field", positionCount: 1 }] },
          headerStrategyByAxis: {
            row: {
              kind: "row",
              locator: { kind: "row", sheet: "Sheet1", row: 1 },
              confidence: 0.9,
            },
          },
          identityStrategy: { kind: "rowPosition", confidence: 0.3 },
          columnBindings: [
            {
              sourceLocator: {
                kind: "byHeaderName",
                axis: "row",
                name: "email",
              },
              columnDefinitionId,
              confidence: 0.9,
            },
          ],
          skipRules: [],
          drift: {
            headerShiftRows: 0,
            addedColumns: "halt",
            removedColumns: { max: 0, action: "halt" },
          },
          confidence: { region: 0.9, aggregate: 0.9 },
          warnings: [],
        },
      ],
      confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
    });

    it("refuses binding a column definition the member can't read; the readable stored one passes", async () => {
      const { connectorInstanceId, planId } = await memberPlan();
      const patch = (columnDefinitionId: string) =>
        request(app)
          .patch(
            `/api/connector-instances/${connectorInstanceId}/layout-plan/${planId}`
          )
          .send({ regions: planBinding(columnDefinitionId).regions });

      const refused = await patch(ownerColId);
      expect([refused.status, refused.body.code]).toEqual([
        404,
        ApiCode.COLUMN_DEFINITION_NOT_FOUND,
      ]);
      const resent = await patch(systemColId);
      expect([resent.status, JSON.stringify(resent.body)]).toEqual([
        200,
        JSON.stringify(resent.body),
      ]);
    });
  });
});
