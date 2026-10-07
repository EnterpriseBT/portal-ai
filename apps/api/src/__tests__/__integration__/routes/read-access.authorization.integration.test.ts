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
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";

/**
 * #692: read routes that skipped the org check, the caller's read permission,
 * or both. #685 inventoried mutation and SSE routes; reads were never
 * inventoried, so a by-id GET could return another org's row (the permission
 * engine doesn't see orgs, so an owner/admin of any org passes a bare `can`).
 *
 * Unreadable == absent: every refusal is a 404 that reveals nothing. Fixture
 * rows are owner-created (never SYSTEM_TEST, which members may read).
 */

const OWNER_SUB = "auth0|ra-owner";
const MEMBER_SUB = "auth0|ra-member";
const OTHER_SUB = "auth0|ra-other-owner";
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
const { tileSourceAuthorizer } =
  await import("../../../routes/portal-map.router.js");

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

describe("Read access (#692)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let fx: TenancyFixture;

  const as = (sub: string) => {
    currentSub = sub;
  };
  const get = (path: string) => request(app).get(path);

  /** A connector instance + entity + column definition + field mapping in an
   *  org, all created by `createdBy`. */
  async function entityChain(
    organizationId: string,
    createdBy: string,
    opts: { refEntityKey?: string } = {}
  ) {
    const definitionId = generateId();
    await db.insert(schema.connectorDefinitions).values({
      id: definitionId,
      slug: `ra-${suffix()}`,
      display: "RA",
      category: "test",
      authType: "none",
      configSchema: null,
      capabilityFlags: { sync: true, read: true, write: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      ...base("SYSTEM_TEST"),
    } as never);
    const instanceId = generateId();
    await db.insert(schema.connectorInstances).values({
      id: instanceId,
      connectorDefinitionId: definitionId,
      organizationId,
      name: "Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true },
      ...base(createdBy),
    } as never);
    const entityId = generateId();
    const entityKey = `ent_${suffix()}`;
    await db.insert(schema.connectorEntities).values({
      id: entityId,
      organizationId,
      connectorInstanceId: instanceId,
      key: entityKey,
      label: "Owner secret entity",
      ...base(createdBy),
    } as never);
    const columnDefinitionId = generateId();
    await db.insert(schema.columnDefinitions).values({
      id: columnDefinitionId,
      organizationId,
      key: `col_${suffix()}`,
      label: "Col",
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      ...base(createdBy),
    } as never);
    const fieldMappingId = generateId();
    await db.insert(schema.fieldMappings).values({
      id: fieldMappingId,
      organizationId,
      connectorEntityId: entityId,
      columnDefinitionId,
      sourceField: "secret_source_field",
      isPrimaryKey: false,
      normalizedKey: `nk_${suffix()}`,
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refEntityKey: opts.refEntityKey ?? null,
      ...base(createdBy),
    } as never);
    // Reconcile the wide table so record reads find `er__<id>`.
    const { wideTableReconcilerService } =
      await import("../../../services/wide-table-reconciler.service.js");
    await wideTableReconcilerService.ensureTable(entityId, db as never);
    return {
      instanceId,
      entityId,
      entityKey,
      columnDefinitionId,
      fieldMappingId,
    };
  }

  async function tagOn(
    organizationId: string,
    connectorEntityId: string,
    createdBy: string
  ) {
    const tagId = generateId();
    await db.insert(schema.entityTags).values({
      id: tagId,
      organizationId,
      name: `secret-tag-${suffix()}`,
      color: null,
      description: null,
      ...base(createdBy),
    } as never);
    await db.insert(schema.entityTagAssignments).values({
      id: generateId(),
      organizationId,
      connectorEntityId,
      entityTagId: tagId,
      ...base(createdBy),
    } as never);
    return tagId;
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
    as(OWNER_SUB);
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Connector entities ──────────────────────────────────────────────

  it("connector entity GET, impact and tags: another org's owner gets 404 and nothing leaks", async () => {
    const chain = await entityChain(fx.orgId, fx.ownerId);
    await tagOn(fx.orgId, chain.entityId, fx.ownerId);
    as(OTHER_SUB);
    for (const path of [
      `/api/connector-entities/${chain.entityId}`,
      `/api/connector-entities/${chain.entityId}/impact`,
      `/api/connector-entities/${chain.entityId}/tags`,
    ]) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
      expect(JSON.stringify(res.body)).not.toMatch(/secret/);
    }
  });

  it("connector entity tags: a member gets 404 on an entity they can't read", async () => {
    const chain = await entityChain(fx.orgId, fx.ownerId);
    await tagOn(fx.orgId, chain.entityId, fx.ownerId);
    as(MEMBER_SUB);
    const res = await get(`/api/connector-entities/${chain.entityId}/tags`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
  });

  it("connector entity GET, impact and tags still serve the owner", async () => {
    const chain = await entityChain(fx.orgId, fx.ownerId);
    const tagId = await tagOn(fx.orgId, chain.entityId, fx.ownerId);
    expect(
      (await get(`/api/connector-entities/${chain.entityId}`)).status
    ).toBe(200);
    expect(
      (await get(`/api/connector-entities/${chain.entityId}/impact`)).status
    ).toBe(200);
    const tags = await get(`/api/connector-entities/${chain.entityId}/tags`);
    expect(tags.status).toBe(200);
    expect(tags.body.payload.tags.map((t: { id: string }) => t.id)).toContain(
      tagId
    );
  });

  it("connector entity impact counts referencing mappings in the caller's org only", async () => {
    const chain = await entityChain(fx.orgId, fx.ownerId);
    // Another org has a mapping whose refEntityKey happens to match.
    await entityChain(fx.otherOrgId, fx.otherOwnerId, {
      refEntityKey: chain.entityKey,
    });
    const res = await get(`/api/connector-entities/${chain.entityId}/impact`);
    expect(res.status).toBe(200);
    expect(res.body.payload.refFieldMappings).toBe(0);
  });

  // ── Entity-group members ────────────────────────────────────────────

  /** An owner-created group with one member (the chain's entity). */
  async function groupWithMember(organizationId: string, createdBy: string) {
    const chain = await entityChain(organizationId, createdBy);
    const groupId = generateId();
    await db.insert(schema.entityGroups).values({
      id: groupId,
      organizationId,
      name: `secret-group-${suffix()}`,
      description: null,
      ...base(createdBy),
    } as never);
    await db.insert(schema.entityGroupMembers).values({
      id: generateId(),
      organizationId,
      entityGroupId: groupId,
      connectorEntityId: chain.entityId,
      linkFieldMappingId: chain.fieldMappingId,
      isPrimary: false,
      ...base(createdBy),
    } as never);
    return { ...chain, groupId };
  }

  const overlapPath = (
    groupId: string,
    targetEntityId: string,
    targetMappingId: string
  ) =>
    `/api/entity-groups/${groupId}/members/overlap?targetConnectorEntityId=${targetEntityId}&targetLinkFieldMappingId=${targetMappingId}`;

  it("group members and overlap: another org's owner gets 404 and nothing leaks", async () => {
    const g = await groupWithMember(fx.orgId, fx.ownerId);
    as(OTHER_SUB);
    for (const path of [
      `/api/entity-groups/${g.groupId}/members`,
      overlapPath(g.groupId, g.entityId, g.fieldMappingId),
    ]) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_GROUP_NOT_FOUND);
      expect(JSON.stringify(res.body)).not.toMatch(/secret/i);
    }
  });

  it("group members and overlap: a member who can't read the group gets 404", async () => {
    const g = await groupWithMember(fx.orgId, fx.ownerId);
    as(MEMBER_SUB);
    for (const path of [
      `/api/entity-groups/${g.groupId}/members`,
      overlapPath(g.groupId, g.entityId, g.fieldMappingId),
    ]) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ENTITY_GROUP_NOT_FOUND);
    }
  });

  it("overlap: a target entity in another org is 404, and a target mapping not on the target entity is refused", async () => {
    const g = await groupWithMember(fx.orgId, fx.ownerId);
    const theirs = await entityChain(fx.otherOrgId, fx.otherOwnerId);
    const crossOrg = await get(
      overlapPath(g.groupId, theirs.entityId, theirs.fieldMappingId)
    );
    expect(crossOrg.status).toBe(404);
    expect(crossOrg.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);

    // Our own target entity, but another org's mapping.
    const ours = await entityChain(fx.orgId, fx.ownerId);
    const foreignMapping = await get(
      overlapPath(g.groupId, ours.entityId, theirs.fieldMappingId)
    );
    expect(foreignMapping.status).toBe(400);
    expect(foreignMapping.body.code).toBe(
      ApiCode.ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID
    );

    // Both ours, but the mapping belongs to a different entity.
    const mismatched = await get(
      overlapPath(g.groupId, ours.entityId, g.fieldMappingId)
    );
    expect(mismatched.status).toBe(400);
    expect(mismatched.body.code).toBe(
      ApiCode.ENTITY_GROUP_MEMBER_LINK_FIELD_INVALID
    );
  });

  it("group members and overlap still serve the owner", async () => {
    const g = await groupWithMember(fx.orgId, fx.ownerId);
    const target = await entityChain(fx.orgId, fx.ownerId);
    const members = await get(`/api/entity-groups/${g.groupId}/members`);
    expect(members.status).toBe(200);
    expect(members.body.payload.members).toHaveLength(1);
    const overlap = await get(
      overlapPath(g.groupId, target.entityId, target.fieldMappingId)
    );
    expect(overlap.status).toBe(200);
  });

  // ── Records, connector definitions, views by station ────────────────

  it("records list, count and by-id: a member gets 404 under an entity they can't read; the owner reads", async () => {
    const chain = await entityChain(fx.orgId, fx.ownerId);
    const paths = [
      `/api/connector-entities/${chain.entityId}/records`,
      `/api/connector-entities/${chain.entityId}/records/count`,
      `/api/connector-entities/${chain.entityId}/records/${generateId()}`,
    ];
    as(MEMBER_SUB);
    for (const path of paths) {
      const res = await get(path);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.CONNECTOR_ENTITY_NOT_FOUND);
      expect(JSON.stringify(res.body)).not.toMatch(/secret/);
    }
    as(OWNER_SUB);
    expect((await get(paths[0])).status).toBe(200);
    expect((await get(paths[1])).status).toBe(200);
  });

  it("connector definition by id: a member without catalog read gets 404, like the list; the owner reads", async () => {
    const chain = await entityChain(fx.orgId, fx.ownerId);
    const [instance] = await db
      .select()
      .from(schema.connectorInstances)
      .where(eq(schema.connectorInstances.id, chain.instanceId));
    const defId = instance.connectorDefinitionId;
    as(MEMBER_SUB);
    const list = await get("/api/connector-definitions");
    const listed = list.body.payload.connectorDefinitions.map(
      (d: { id: string }) => d.id
    );
    expect(listed).not.toContain(defId);
    const res = await get(`/api/connector-definitions/${defId}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.CONNECTOR_DEFINITION_NOT_FOUND);
    as(OWNER_SUB);
    expect((await get(`/api/connector-definitions/${defId}`)).status).toBe(200);
  });

  it("curated views by station: an unreadable or another org's station is 404; the caller's own station lists", async () => {
    const station = async (organizationId: string, createdBy: string) => {
      const id = generateId();
      await db.insert(schema.stations).values({
        id,
        organizationId,
        name: `Station ${suffix()}`,
        description: null,
        ...base(createdBy),
      } as never);
      return id;
    };
    const ownersStation = await station(fx.orgId, fx.ownerId);
    const membersStation = await station(fx.orgId, fx.memberId);
    const otherOrgStation = await station(fx.otherOrgId, fx.otherOwnerId);

    as(MEMBER_SUB);
    const refused = await get(`/api/curated-views?stationId=${ownersStation}`);
    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe(ApiCode.STATION_NOT_FOUND);
    expect(
      (await get(`/api/curated-views?stationId=${membersStation}`)).status
    ).toBe(200);

    as(OWNER_SUB);
    const crossOrg = await get(
      `/api/curated-views?stationId=${otherOrgStation}`
    );
    expect(crossOrg.status).toBe(404);
    expect(crossOrg.body.code).toBe(ApiCode.STATION_NOT_FOUND);
    expect(
      (await get(`/api/curated-views?stationId=${ownersStation}`)).status
    ).toBe(200);
  });

  // ── Uploads and map tiles ───────────────────────────────────────────

  it("sheet-slice: a member gets 404 on another member's upload session", async () => {
    const uploadSessionId = generateId();
    await db.insert(schema.fileUploads).values({
      id: generateId(),
      organizationId: fx.orgId,
      filename: "secret.csv",
      contentType: "text/csv",
      sizeBytes: 10,
      s3Key: `uploads/${generateId()}`,
      status: "uploaded",
      uploadSessionId,
      ...base(fx.ownerId),
    } as never);
    const path = `/api/file-uploads/sheet-slice?uploadSessionId=${uploadSessionId}&sheetId=s1&rowStart=0&rowEnd=1&colStart=0&colEnd=1`;
    as(MEMBER_SUB);
    const res = await get(path);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.FILE_UPLOAD_NOT_FOUND);
    as(OTHER_SUB);
    expect((await get(path)).body.code).toBe(ApiCode.FILE_UPLOAD_NOT_FOUND);
  });

  it("map tiles: the source authorizer allows a portal's own reader and refuses a member and another org", async () => {
    const stationId = generateId();
    await db.insert(schema.stations).values({
      id: stationId,
      organizationId: fx.orgId,
      name: `Station ${suffix()}`,
      description: null,
      ...base(fx.ownerId),
    } as never);
    const portalId = generateId();
    await db.insert(schema.portals).values({
      id: portalId,
      organizationId: fx.orgId,
      stationId,
      name: "Owner portal",
      lastOpened: null,
      ...base(fx.ownerId),
    } as never);
    const pin = async (createdBy: string) => {
      const id = generateId();
      await db.insert(schema.portalResults).values({
        id,
        organizationId: fx.orgId,
        stationId,
        portalId,
        name: `pin ${suffix()}`,
        type: "text",
        content: {},
        ...base(createdBy),
      } as never);
      return id;
    };
    const ownersPin = await pin(fx.ownerId);
    const membersPin = await pin(fx.memberId);

    const owner = tileSourceAuthorizer({
      userId: fx.ownerId,
      organizationId: fx.orgId,
      roles: ["owner"],
    });
    const member = tileSourceAuthorizer({
      userId: fx.memberId,
      organizationId: fx.orgId,
      roles: ["member"],
    });
    const otherOrg = tileSourceAuthorizer({
      userId: fx.otherOwnerId,
      organizationId: fx.otherOrgId,
      roles: ["owner"],
    });

    const message = { kind: "message" as const, portalId };
    expect(await owner(message)).toBe(true);
    expect(await member(message)).toBe(false);
    expect(await otherOrg(message)).toBe(false);

    const pinSource = (id: string, createdBy: string) => ({
      kind: "pin" as const,
      id,
      createdBy,
    });
    expect(await owner(pinSource(ownersPin, fx.ownerId))).toBe(true);
    expect(await member(pinSource(ownersPin, fx.ownerId))).toBe(false);
    expect(await member(pinSource(membersPin, fx.memberId))).toBe(true);
  });

  // ── Jobs: payloads are the creator's (and owner/admin's) ────────────

  async function jobWithPayload(createdBy: string) {
    const id = generateId();
    await db.insert(schema.jobs).values({
      id,
      organizationId: fx.orgId,
      type: "file_upload_parse",
      status: "completed",
      progress: 100,
      metadata: { uploadSessionId: "secret-session", uploadIds: ["u1"] },
      result: { sheets: [{ name: "secret-sheet", cells: [["secret-cell"]] }] },
      error: null,
      startedAt: null,
      completedAt: now,
      bullJobId: null,
      attempts: 1,
      maxAttempts: 3,
      ...base(createdBy),
    } as never);
    return id;
  }

  it("jobs: a member sees another member's job without its metadata or result, in the list, by id and on the SSE snapshot", async () => {
    const ownersJob = await jobWithPayload(fx.ownerId);
    as(MEMBER_SUB);

    const list = await get("/api/jobs?limit=100");
    expect(list.status).toBe(200);
    const row = list.body.payload.jobs.find(
      (j: { id: string }) => j.id === ownersJob
    );
    expect(row).toBeDefined();
    expect(row.status).toBe("completed");
    expect(row.metadata).toEqual({});
    expect(row.result).toBeNull();

    const one = await get(`/api/jobs/${ownersJob}`);
    expect(one.status).toBe(200);
    expect(one.body.payload.job.metadata).toEqual({});
    expect(one.body.payload.job.result).toBeNull();

    const sse = await get(`/api/sse/jobs/${ownersJob}/events?token=x`);
    expect(sse.status).toBe(200);
    expect(sse.text).toContain("event: snapshot");
    expect(sse.text).not.toMatch(/secret/);

    expect(JSON.stringify([list.body, one.body])).not.toMatch(/secret/);
  });

  it("jobs: the creator and the owner see the full payload", async () => {
    const membersJob = await jobWithPayload(fx.memberId);
    as(MEMBER_SUB);
    const own = await get(`/api/jobs/${membersJob}`);
    expect(own.body.payload.job.metadata.uploadSessionId).toBe(
      "secret-session"
    );
    expect(
      (await get(`/api/sse/jobs/${membersJob}/events?token=x`)).text
    ).toContain("secret-sheet");

    as(OWNER_SUB);
    const asOwner = await get(`/api/jobs/${membersJob}`);
    expect(asOwner.body.payload.job.result.sheets[0].name).toBe("secret-sheet");
    const ownerList = await get("/api/jobs?limit=100");
    expect(
      ownerList.body.payload.jobs.find(
        (j: { id: string }) => j.id === membersJob
      ).metadata.uploadSessionId
    ).toBe("secret-session");
  });

  // ── Small ones: grants on an unreadable object, impact's counterpart ──

  it("grants: listing shares on an object the caller can't read is 404, not 403", async () => {
    const stationId = generateId();
    await db.insert(schema.stations).values({
      id: stationId,
      organizationId: fx.orgId,
      name: `Station ${suffix()}`,
      description: null,
      ...base(fx.ownerId),
    } as never);
    as(MEMBER_SUB);
    const res = await get(
      `/api/grants?resourceType=station&resourceId=${stationId}`
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.STATION_NOT_FOUND);
    as(OWNER_SUB);
    expect(
      (await get(`/api/grants?resourceType=station&resourceId=${stationId}`))
        .status
    ).toBe(200);
  });

  it("field-mapping impact omits a counterpart mapping the caller can't read", async () => {
    // A member's entity whose mapping references the owner's entity, and the
    // owner's counterpart mapping pointing back.
    const ownersChain = await entityChain(fx.orgId, fx.ownerId);
    const membersChain = await entityChain(fx.orgId, fx.memberId);
    const counterpartKey = `nk_counter_${suffix()}`;
    const membersMappingId = generateId();
    await db.insert(schema.fieldMappings).values({
      id: membersMappingId,
      organizationId: fx.orgId,
      connectorEntityId: membersChain.entityId,
      columnDefinitionId: membersChain.columnDefinitionId,
      sourceField: "ref_field",
      isPrimaryKey: false,
      normalizedKey: `nk_${suffix()}`,
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refEntityKey: ownersChain.entityKey,
      refNormalizedKey: counterpartKey,
      ...base(fx.memberId),
    } as never);
    const counterpartId = generateId();
    await db.insert(schema.fieldMappings).values({
      id: counterpartId,
      organizationId: fx.orgId,
      connectorEntityId: ownersChain.entityId,
      columnDefinitionId: ownersChain.columnDefinitionId,
      sourceField: "owners_secret_counterpart",
      isPrimaryKey: false,
      normalizedKey: counterpartKey,
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refEntityKey: membersChain.entityKey,
      ...base(fx.ownerId),
    } as never);

    as(MEMBER_SUB);
    const asMember = await get(
      `/api/field-mappings/${membersMappingId}/impact`
    );
    expect(asMember.status).toBe(200);
    expect(asMember.body.payload.counterpart).toBeNull();
    expect(JSON.stringify(asMember.body)).not.toMatch(/secret/);

    as(OWNER_SUB);
    const asOwner = await get(`/api/field-mappings/${membersMappingId}/impact`);
    expect(asOwner.body.payload.counterpart.id).toBe(counterpartId);
  });
  // ── #694: same-org leftovers of the #692 inventory ──────────────────

  /** Share an object with a user at `verb` (an object grant). */
  async function shareWith(
    principalId: string,
    verb: string,
    resourceType: string,
    resourceId: string
  ) {
    await db.insert(schema.permissionGrants).values({
      id: generateId(),
      organizationId: fx.orgId,
      principalType: "user",
      principalId,
      effect: "allow",
      verb,
      resourceType,
      resourceId,
      condition: null,
      conditionParam: null,
      ...base(fx.ownerId),
    } as never);
  }

  it("pins: include=portal names the source portal only to a caller who can read it", async () => {
    const stationId = generateId();
    await db.insert(schema.stations).values({
      id: stationId,
      organizationId: fx.orgId,
      name: `Station ${suffix()}`,
      description: null,
      toolPacks: ["data_query"],
      ...base(fx.ownerId),
    } as never);
    const portalId = generateId();
    await db.insert(schema.portals).values({
      id: portalId,
      organizationId: fx.orgId,
      stationId,
      name: "Owner secret portal",
      ...base(fx.ownerId),
    } as never);
    const pinId = generateId();
    await db.insert(schema.portalResults).values({
      id: pinId,
      organizationId: fx.orgId,
      stationId,
      portalId,
      name: "Shared pin",
      type: "text",
      content: { value: "hello" },
      ...base(fx.ownerId),
    } as never);
    await shareWith(fx.memberId, "read", "pin", pinId);

    as(MEMBER_SUB);
    const asMember = await get("/api/portal-results?include=portal");
    expect(asMember.status).toBe(200);
    const memberPin = asMember.body.payload.portalResults.find(
      (r: { id: string }) => r.id === pinId
    );
    expect(memberPin).toBeDefined();
    expect(memberPin.portalName).toBeNull();
    expect(JSON.stringify(asMember.body)).not.toMatch(/secret/i);

    as(OWNER_SUB);
    const asOwner = await get("/api/portal-results?include=portal");
    const ownerPin = asOwner.body.payload.portalResults.find(
      (r: { id: string }) => r.id === pinId
    );
    expect(ownerPin.portalName).toBe("Owner secret portal");
  });
  /** An `entity_records` row and its wide-table row on `connectorEntityId`,
   *  created by `createdBy`. Hydrated reads join the wide table, so a record
   *  without its row isn't read at all. */
  async function recordOn(
    connectorEntityId: string,
    createdBy: string,
    sourceId: string,
    normalizedData: Record<string, unknown> = {}
  ) {
    const id = generateId();
    await db.insert(schema.entityRecords).values({
      id,
      organizationId: fx.orgId,
      connectorEntityId,
      sourceId,
      data: {},
      checksum: `c-${sourceId}`,
      syncedAt: now,
      ...base(createdBy),
    } as never);
    const { wideTableRepo } =
      await import("../../../db/repositories/wide-table.repository.js");
    const { wideTableStatementCache } =
      await import("../../../services/wide-table-statement.cache.js");
    const { projectToWideRow, buildMappingsForProjection } =
      await import("../../../services/wide-table-projection.util.js");
    const stmt = await wideTableStatementCache.get(
      connectorEntityId,
      db as never
    );
    await wideTableRepo.upsertMany(
      connectorEntityId,
      [
        projectToWideRow(
          {
            id,
            organizationId: fx.orgId,
            sourceId,
            syncedAt: now,
            isValid: true,
            normalizedData,
          },
          buildMappingsForProjection(stmt.columns)
        ),
      ],
      db as never
    );
    return id;
  }

  it("validate-bidirectional checks only the records the caller can read", async () => {
    // A member's entity A whose reference-array mapping points at the owner's
    // entity B, and B's counterpart pointing back.
    const a = await entityChain(fx.orgId, fx.memberId);
    const b = await entityChain(fx.orgId, fx.ownerId);
    const refColId = generateId();
    await db.insert(schema.columnDefinitions).values({
      id: refColId,
      organizationId: fx.orgId,
      key: `refs_${suffix()}`,
      label: "Refs",
      type: "reference-array",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      ...base(fx.memberId),
    } as never);
    const nkA = `refs_a_${suffix()}`;
    const nkB = `refs_b_${suffix()}`;
    const refMapping = (
      id: string,
      entityId: string,
      normalizedKey: string,
      refEntityKey: string,
      refNormalizedKey: string,
      createdBy: string
    ) => ({
      id,
      organizationId: fx.orgId,
      connectorEntityId: entityId,
      columnDefinitionId: refColId,
      sourceField: normalizedKey,
      isPrimaryKey: false,
      normalizedKey,
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refEntityKey,
      refNormalizedKey,
      ...base(createdBy),
    });
    const mappingAId = generateId();
    await db
      .insert(schema.fieldMappings)
      .values([
        refMapping(mappingAId, a.entityId, nkA, b.entityKey, nkB, fx.memberId),
        refMapping(generateId(), b.entityId, nkB, a.entityKey, nkA, fx.ownerId),
      ] as never);
    const { wideTableReconcilerService } =
      await import("../../../services/wide-table-reconciler.service.js");
    await wideTableReconcilerService.reconcileEntity(a.entityId, db as never);
    await wideTableReconcilerService.reconcileEntity(b.entityId, db as never);

    // Both of A's records reference a B record that doesn't exist, so both
    // are inconsistent; only one is the member's.
    const membersRecord = await recordOn(a.entityId, fx.memberId, "a1", {
      [nkA]: ["missing-1"],
    });
    const ownersRecord = await recordOn(a.entityId, fx.ownerId, "a2", {
      [nkA]: ["missing-2"],
    });
    // A correct link to a B record the member can't read: not checkable for
    // the member, so not reported as broken (code review on #694).
    await recordOn(a.entityId, fx.memberId, "a3", { [nkA]: ["b1"] });
    await recordOn(b.entityId, fx.ownerId, "b1", { [nkB]: ["a3"] });
    const path = `/api/field-mappings/${mappingAId}/validate-bidirectional`;

    as(MEMBER_SUB);
    const asMember = await get(path);
    expect(asMember.status).toBe(200);
    expect(asMember.body.payload.totalChecked).toBe(2);
    expect(asMember.body.payload.inconsistentRecordIds).toEqual([
      membersRecord,
    ]);

    as(OWNER_SUB);
    const asOwner = await get(path);
    expect(asOwner.body.payload.totalChecked).toBe(3);
    expect([...asOwner.body.payload.inconsistentRecordIds].sort()).toEqual(
      [membersRecord, ownersRecord].sort()
    );
  });

  /** A group readable by the member, holding the member's own entity and an
   *  owner-created entity the member can't read. */
  async function mixedGroup() {
    const mine = await entityChain(fx.orgId, fx.memberId);
    const owners = await entityChain(fx.orgId, fx.ownerId);
    const groupId = generateId();
    await db.insert(schema.entityGroups).values({
      id: groupId,
      organizationId: fx.orgId,
      name: `group-${suffix()}`,
      description: null,
      ...base(fx.ownerId),
    } as never);
    await db.insert(schema.entityGroupMembers).values(
      [mine, owners].map((c) => ({
        id: generateId(),
        organizationId: fx.orgId,
        entityGroupId: groupId,
        connectorEntityId: c.entityId,
        linkFieldMappingId: c.fieldMappingId,
        isPrimary: false,
        ...base(fx.ownerId),
      })) as never
    );
    // Members don't read entity groups by default; this one is granted.
    await shareWith(fx.memberId, "read", "entity_group", groupId);
    return { groupId, mine, owners };
  }

  it("group members omits a member entity the caller can't read", async () => {
    const g = await mixedGroup();

    as(MEMBER_SUB);
    const asMember = await get(`/api/entity-groups/${g.groupId}/members`);
    expect(asMember.status).toBe(200);
    expect(
      asMember.body.payload.members.map(
        (m: { connectorEntityId: string }) => m.connectorEntityId
      )
    ).toEqual([g.mine.entityId]);

    as(OWNER_SUB);
    const asOwner = await get(`/api/entity-groups/${g.groupId}/members`);
    expect(asOwner.body.payload.members).toHaveLength(2);
  });

  it("group detail and resolve omit a member entity the caller can't read", async () => {
    const g = await mixedGroup();
    const ids = (rows: { connectorEntityId: string }[]) =>
      rows.map((r) => r.connectorEntityId).sort();

    as(MEMBER_SUB);
    const detail = await get(`/api/entity-groups/${g.groupId}`);
    expect(detail.status).toBe(200);
    expect(ids(detail.body.payload.entityGroup.members)).toEqual([
      g.mine.entityId,
    ]);
    const resolve = await get(
      `/api/entity-groups/${g.groupId}/resolve?linkValue=x`
    );
    expect(resolve.status).toBe(200);
    expect(ids(resolve.body.payload.results)).toEqual([g.mine.entityId]);

    as(OWNER_SUB);
    const ownerDetail = await get(`/api/entity-groups/${g.groupId}`);
    expect(ids(ownerDetail.body.payload.entityGroup.members)).toEqual(
      [g.mine.entityId, g.owners.entityId].sort()
    );
    const ownerResolve = await get(
      `/api/entity-groups/${g.groupId}/resolve?linkValue=x`
    );
    expect(ids(ownerResolve.body.payload.results)).toEqual(
      [g.mine.entityId, g.owners.entityId].sort()
    );
  });

  it("overlap counts only records the caller can read, over member entities they can read", async () => {
    const g = await mixedGroup();
    // The member's entity holds one record of theirs and one of the owner's;
    // the owner's entity holds two of the owner's.
    await recordOn(g.mine.entityId, fx.memberId, "m1");
    await recordOn(g.mine.entityId, fx.ownerId, "o1");
    await recordOn(g.owners.entityId, fx.ownerId, "o2");
    await recordOn(g.owners.entityId, fx.ownerId, "o3");
    const path = overlapPath(g.groupId, g.mine.entityId, g.mine.fieldMappingId);

    as(MEMBER_SUB);
    const asMember = await get(path);
    expect(asMember.status).toBe(200);
    expect(asMember.body.payload.targetRecordCount).toBe(1);
    expect(asMember.body.payload.sourceRecordCount).toBe(1);

    as(OWNER_SUB);
    const asOwner = await get(path);
    expect(asOwner.body.payload.targetRecordCount).toBe(2);
    expect(asOwner.body.payload.sourceRecordCount).toBe(4);
  });
  // ── #699: a turn runs against the portal's station ─────────────────

  it("sending in a portal needs read on its station: revoked or deleted is 404 and writes nothing", async () => {
    const stationId = generateId();
    await db.insert(schema.stations).values({
      id: stationId,
      organizationId: fx.orgId,
      name: `Station ${suffix()}`,
      description: null,
      toolPacks: ["data_query"],
      ...base(fx.ownerId),
    } as never);
    const portalId = generateId();
    await db.insert(schema.portals).values({
      id: portalId,
      organizationId: fx.orgId,
      stationId,
      name: "Member portal",
      ...base(fx.memberId),
    } as never);
    await shareWith(fx.memberId, "read", "station", stationId);
    const send = () =>
      request(app)
        .post(`/api/portals/${portalId}/messages`)
        .send({ message: "hello" });
    const messageCount = async () =>
      (
        await db
          .select()
          .from(schema.portalMessages)
          .where(eq(schema.portalMessages.portalId, portalId))
      ).length;

    as(MEMBER_SUB);
    expect((await send()).status).toBe(200);
    expect(await messageCount()).toBe(1);

    // The owner revokes the share.
    await db
      .delete(schema.permissionGrants)
      .where(eq(schema.permissionGrants.resourceId, stationId));
    const revoked = await send();
    expect(revoked.status).toBe(404);
    expect(revoked.body.code).toBe(ApiCode.STATION_NOT_FOUND);
    expect(await messageCount()).toBe(1);

    // Re-shared, then the station is deleted: absent reads the same.
    await shareWith(fx.memberId, "read", "station", stationId);
    await db
      .update(schema.stations)
      .set({ deleted: Date.now(), deletedBy: fx.ownerId } as never)
      .where(eq(schema.stations.id, stationId));
    const deleted = await send();
    expect(deleted.status).toBe(404);
    expect(deleted.body.code).toBe(ApiCode.STATION_NOT_FOUND);
    expect(await messageCount()).toBe(1);
  });
});
