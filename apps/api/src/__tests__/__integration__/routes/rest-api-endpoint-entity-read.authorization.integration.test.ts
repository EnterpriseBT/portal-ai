import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import request from "supertest";
import type {
  Request,
  Response as ExpressResponse,
  NextFunction,
} from "express";
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
 * #780 / #782: a REST endpoint is an entity with its own permissions. A caller
 * who can read the connector but not one of its endpoint entities must not
 * see that endpoint's config, nor its live records through test-connection.
 * Unreadable == absent: the same answer as an endpoint that isn't there.
 *
 * Fixture: the member's own REST connector, holding one endpoint the member
 * created (readable) and one the owner created (unreadable to the member).
 */

const OWNER_SUB = "auth0|ep-read-owner";
const MEMBER_SUB = "auth0|ep-read-member";
const OTHER_SUB = "auth0|ep-read-other-owner";
let currentSub = OWNER_SUB;

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: ExpressResponse, next: NextFunction) => {
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
const { configureRestApiAdapterDeps, __resetRestApiAdapterDepsForTests } =
  await import("../../../adapters/rest-api/rest-api.adapter.js");
const { ProbeCache } =
  await import("../../../adapters/rest-api/probe-cache.util.js");

const now = Date.now();
const base = (createdBy: string) => ({
  created: now,
  createdBy,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});

describe("REST endpoint entity permissions (#780 reads, #782 writes)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let fx: TenancyFixture;
  let instanceId: string;
  let memberEntityId: string;
  let ownerEntityId: string;
  let originalFetch: typeof globalThis.fetch;

  async function createEndpoint(sub: string, key: string): Promise<string> {
    currentSub = sub;
    const res = await request(app)
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
      });
    if (res.status !== 201) {
      throw new Error(
        `Failed to seed endpoint (status ${res.status}): ${JSON.stringify(res.body)}`
      );
    }
    return res.body.payload.entity.id;
  }

  function stubFetch(body: unknown) {
    // A fresh Response per call: a body can only be read once.
    globalThis.fetch = jest.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    ) as unknown as typeof globalThis.fetch;
  }

  const testConnection = (endpointEntityId: string) =>
    request(app)
      .post(`/api/connector-instances/${instanceId}/test-connection`)
      .send({ endpointEntityId });

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
      name: "Member's REST connector",
      status: "active",
      config: { baseUrl: "https://api.example.com", auth: { mode: "none" } },
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: null,
      ...base(fx.memberId),
    } as never);

    memberEntityId = await createEndpoint(MEMBER_SUB, "mine");
    ownerEntityId = await createEndpoint(OWNER_SUB, "theirs");
    originalFetch = globalThis.fetch;
    __resetRestApiAdapterDepsForTests();
    configureRestApiAdapterDeps({ cache: new ProbeCache(), classifier: null });
    currentSub = MEMBER_SUB;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    __resetRestApiAdapterDepsForTests();
    await connection.end();
  });

  it("lists only the endpoints the caller can read", async () => {
    const asMember = await request(app).get(
      `/api/connector-instances/${instanceId}/api-endpoints`
    );
    expect(asMember.status).toBe(200);
    expect(
      asMember.body.payload.endpoints.map(
        (e: { entity: { id: string } }) => e.entity.id
      )
    ).toEqual([memberEntityId]);

    currentSub = OWNER_SUB;
    const asOwner = await request(app).get(
      `/api/connector-instances/${instanceId}/api-endpoints`
    );
    expect(
      asOwner.body.payload.endpoints
        .map((e: { entity: { id: string } }) => e.entity.id)
        .sort()
    ).toEqual([memberEntityId, ownerEntityId].sort());
  });

  it("answers 404 for an unreadable endpoint, 200 for a readable one", async () => {
    const unreadable = await request(app).get(
      `/api/connector-instances/${instanceId}/api-endpoints/${ownerEntityId}`
    );
    expect(unreadable.status).toBe(404);
    expect(unreadable.body.code).toBe(ApiCode.REST_API_ENDPOINT_NOT_FOUND);

    const readable = await request(app).get(
      `/api/connector-instances/${instanceId}/api-endpoints/${memberEntityId}`
    );
    expect(readable.status).toBe(200);
    expect(readable.body.payload.entity.id).toBe(memberEntityId);
  });

  it("tests an unreadable endpoint as if it were absent, without calling it", async () => {
    stubFetch([{ id: 1 }]);

    const unreadable = await testConnection(ownerEntityId);
    const absentId = generateId();
    const absent = await testConnection(absentId);

    expect(unreadable.status).toBe(200);
    expect(unreadable.body.payload).toEqual(
      JSON.parse(
        JSON.stringify(absent.body.payload).replaceAll(absentId, ownerEntityId)
      )
    );
    expect(unreadable.body.payload).toMatchObject({
      ok: false,
      code: ApiCode.REST_API_ENDPOINT_NOT_FOUND,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("tests a readable endpoint, and the owner tests either", async () => {
    stubFetch([{ id: 1 }, { id: 2 }]);
    const own = await testConnection(memberEntityId);
    expect(own.body.payload).toMatchObject({ ok: true });

    currentSub = OWNER_SUB;
    const theirs = await testConnection(ownerEntityId);
    expect(theirs.body.payload).toMatchObject({ ok: true });
    expect(theirs.body.payload.sample).toHaveLength(2);
  });

  // ── #782: the write routes check the endpoint's entity too ─────────────

  const endpointUrl = (entityId: string) =>
    `/api/connector-instances/${instanceId}/api-endpoints/${entityId}`;
  const patchLabel = (entityId: string, label: string) =>
    request(app).patch(endpointUrl(entityId)).send({ label });
  const discover = (entityId: string) =>
    request(app)
      .post(`${endpointUrl(entityId)}/discover-columns`)
      .send({});

  async function ownerReads(entityId: string) {
    const prev = currentSub;
    currentSub = OWNER_SUB;
    const res = await request(app).get(endpointUrl(entityId));
    currentSub = prev;
    return res;
  }

  it("a member can't edit, delete or sample an endpoint they can't read (404), and nothing changes", async () => {
    stubFetch([{ id: 1 }]);

    const patched = await patchLabel(ownerEntityId, "hijacked");
    const deleted = await request(app).delete(endpointUrl(ownerEntityId));
    const sampled = await discover(ownerEntityId);

    for (const res of [patched, deleted, sampled]) {
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.REST_API_ENDPOINT_NOT_FOUND);
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const after = await ownerReads(ownerEntityId);
    expect(after.status).toBe(200);
    expect(after.body.payload.entity.label).toBe("theirs");
  });

  it("a member gets 403 editing or deleting an endpoint they can read but not change, and can sample it", async () => {
    // An entity created by SYSTEM_TEST, which members may read.
    await db
      .update(schema.connectorEntities)
      .set({ createdBy: "SYSTEM_TEST" } as never)
      .where(eq(schema.connectorEntities.id, ownerEntityId));
    stubFetch([{ id: 1, name: "a" }]);

    const patched = await patchLabel(ownerEntityId, "nope");
    const deleted = await request(app).delete(endpointUrl(ownerEntityId));
    expect(patched.status).toBe(403);
    expect(patched.body.code).toBe(ApiCode.PERMISSION_DENIED);
    expect(deleted.status).toBe(403);
    expect(deleted.body.code).toBe(ApiCode.PERMISSION_DENIED);

    const sampled = await discover(ownerEntityId);
    expect(sampled.status).toBe(200);
    expect((await ownerReads(ownerEntityId)).body.payload.entity.label).toBe(
      "theirs"
    );
  });

  it("a member edits and samples their own endpoint; the owner edits and deletes the member's", async () => {
    stubFetch([{ id: 1 }]);
    expect((await patchLabel(memberEntityId, "renamed")).status).toBe(200);
    expect((await discover(memberEntityId)).status).toBe(200);

    currentSub = OWNER_SUB;
    expect((await patchLabel(memberEntityId, "by owner")).status).toBe(200);
    expect(
      (await request(app).delete(endpointUrl(memberEntityId))).status
    ).toBe(200);
    expect((await request(app).get(endpointUrl(memberEntityId))).status).toBe(
      404
    );
  });
});
