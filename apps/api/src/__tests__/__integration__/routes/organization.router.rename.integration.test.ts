import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { StripeService } from "../../../services/stripe.service.js";
import {
  allowForUser,
  createOrganizationUser,
  createUser,
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";

/**
 * #907: renaming an organization through `PATCH /api/organization/:id`. Each
 * field is checked only when present (`name` → `org.write`, `defaultStationId`
 * → class station write), the body is strict, a real rename is audited as
 * `org.update` and copied to the Stripe customer best effort, and concurrent
 * renames each record the name they replaced.
 */

const OWNER_SUB = "auth0|rename-owner";
const ADMIN_SUB = "auth0|rename-admin";
const MEMBER_SUB = "auth0|rename-member";
const OTHER_SUB = "auth0|rename-other-owner";
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

const ORIGINAL = "Acme";

/** Poll until `read` returns a truthy value: the audit and Stripe calls run
 *  after the response, so they may land a moment later. */
async function eventually<T>(read: () => Promise<T> | T): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (value || Date.now() > deadline) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("PATCH /api/organization/:id — rename (#907)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let fx: TenancyFixture;
  let adminId: string;
  let stationId: string;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });
  });

  afterAll(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  beforeEach(async () => {
    await teardownOrg(db);
    fx = await seedTenancyFixture(db, {
      owner: OWNER_SUB,
      member: MEMBER_SUB,
      otherOwner: OTHER_SUB,
    });
    const admin = createUser(ADMIN_SUB);
    await db.insert(schema.users).values(admin as never);
    await db
      .insert(schema.organizationUsers)
      .values(
        createOrganizationUser(fx.orgId, admin.id, { role: "admin" }) as never
      );
    adminId = admin.id;

    stationId = generateId();
    await db.insert(schema.stations).values({
      id: stationId,
      organizationId: fx.orgId,
      name: "Default station",
      description: null,
      created: Date.now(),
      createdBy: fx.ownerId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    await db
      .update(schema.organizations)
      .set({ name: ORIGINAL, defaultStationId: stationId })
      .where(eq(schema.organizations.id, fx.orgId));
    currentSub = OWNER_SUB;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const patch = (body: unknown, orgId = fx.orgId) =>
    request(app)
      .patch(`/api/organization/${orgId}`)
      .send(body as object);

  const orgRow = async () => {
    const [row] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, fx.orgId));
    return row;
  };

  const auditRows = () =>
    db
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.organizationId, fx.orgId),
          eq(schema.auditLog.action, "org.update")
        )
      );

  // ── Permission ──────────────────────────────────────────────────────

  it.each([
    ["owner", OWNER_SUB],
    ["admin", ADMIN_SUB],
  ])(
    "an %s renames with a name-only body, leaving the default station",
    async (_role, sub) => {
      currentSub = sub;
      const res = await patch({ name: "Acme Corp" });
      expect(res.status).toBe(200);
      expect(res.body.payload.organization.name).toBe("Acme Corp");
      expect(res.body.payload.organization.defaultStationId).toBe(stationId);
      const row = await orgRow();
      expect(row.name).toBe("Acme Corp");
      expect(row.defaultStationId).toBe(stationId);
    }
  );

  it("a member is refused with PERMISSION_DENIED and the row is unchanged", async () => {
    currentSub = MEMBER_SUB;
    const res = await patch({ name: "Hijacked" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.PERMISSION_DENIED);
    expect(res.body.message).toBe(
      "You don't have permission to edit the organization."
    );
    expect((await orgRow()).name).toBe(ORIGINAL);
  });

  it("a member granted write org by a custom policy may rename", async () => {
    await allowForUser(db, {
      organizationId: fx.orgId,
      userId: fx.memberId,
      verb: "write",
      resourceType: "org",
    });
    currentSub = MEMBER_SUB;
    const res = await patch({ name: "Acme Corp" });
    expect(res.status).toBe(200);
    expect((await orgRow()).name).toBe("Acme Corp");
  });

  it("a station-only body behaves as #690: refused for a member, allowed for an owner, name kept", async () => {
    currentSub = MEMBER_SUB;
    expect((await patch({ defaultStationId: null })).status).toBe(403);

    currentSub = OWNER_SUB;
    const res = await patch({ defaultStationId: null });
    expect(res.status).toBe(200);
    const row = await orgRow();
    expect(row.defaultStationId).toBeNull();
    expect(row.name).toBe(ORIGINAL);
  });

  it("a body with both fields needs both permissions, and writes nothing on a refusal", async () => {
    // write org alone: the station half still refuses.
    await allowForUser(db, {
      organizationId: fx.orgId,
      userId: fx.memberId,
      verb: "write",
      resourceType: "org",
    });
    currentSub = MEMBER_SUB;
    const res = await patch({ name: "Acme Corp", defaultStationId: null });
    expect(res.status).toBe(403);
    const row = await orgRow();
    expect(row.name).toBe(ORIGINAL);
    expect(row.defaultStationId).toBe(stationId);

    currentSub = OWNER_SUB;
    const ok = await patch({ name: "Acme Corp", defaultStationId: null });
    expect(ok.status).toBe(200);
    expect(ok.body.payload.organization).toMatchObject({
      name: "Acme Corp",
      defaultStationId: null,
    });
  });

  // ── Validation ──────────────────────────────────────────────────────

  it.each([
    ["an empty body", {}],
    ["an unknown key", { name: "Acme Corp", timezone: "UTC" }],
    ["a blank name", { name: "   " }],
    ["a 121-character name", { name: "a".repeat(121) }],
    ["a name with a line break", { name: "Acme\nCorp" }],
  ])("%s is 400 ORGANIZATION_INVALID_PAYLOAD", async (_label, body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.ORGANIZATION_INVALID_PAYLOAD);
    expect((await orgRow()).name).toBe(ORIGINAL);
  });

  it("another org's id is 404 before the body is validated", async () => {
    const res = await patch({ bogus: true }, fx.otherOrgId);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.ORGANIZATION_NOT_FOUND);
  });

  it("two orgs may share a name", async () => {
    await db
      .update(schema.organizations)
      .set({ name: "Shared" })
      .where(eq(schema.organizations.id, fx.otherOrgId));
    const res = await patch({ name: "Shared" });
    expect(res.status).toBe(200);
  });

  // ── Audit ───────────────────────────────────────────────────────────

  it("a rename records one org.update entry with from, to and the actor", async () => {
    currentSub = ADMIN_SUB;
    expect((await patch({ name: "Acme Corp" })).status).toBe(200);
    const rows = await eventually(async () => {
      const r = await auditRows();
      return r.length ? r : null;
    });
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({
      userId: adminId,
      targetType: "organization",
      targetId: fx.orgId,
      outcome: "success",
      metadata: { field: "name", from: ORIGINAL, to: "Acme Corp" },
    });
  });

  it("an unchanged name records nothing", async () => {
    expect((await patch({ name: ` ${ORIGINAL} ` })).status).toBe(200);
    // The audit write would run after the response; give it time to land.
    await new Promise((r) => setTimeout(r, 300));
    expect(await auditRows()).toHaveLength(0);
  });

  // ── Stripe ──────────────────────────────────────────────────────────

  describe("with a Stripe customer", () => {
    beforeEach(async () => {
      await db
        .update(schema.organizations)
        .set({ stripeCustomerId: `cus_${generateId()}` })
        .where(eq(schema.organizations.id, fx.orgId));
      jest.spyOn(StripeService, "isConfigured").mockReturnValue(true);
    });

    it("copies the new name to the customer once", async () => {
      const update = jest
        .spyOn(StripeService, "updateCustomerName")
        .mockResolvedValue(undefined);
      expect((await patch({ name: "Acme Corp" })).status).toBe(200);
      await eventually(() => update.mock.calls.length > 0);
      const { stripeCustomerId } = await orgRow();
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(stripeCustomerId, "Acme Corp");
    });

    it("still renames when Stripe fails", async () => {
      const update = jest
        .spyOn(StripeService, "updateCustomerName")
        .mockRejectedValue(new Error("stripe down"));
      const res = await patch({ name: "Acme Corp" });
      expect(res.status).toBe(200);
      await eventually(() => update.mock.calls.length > 0);
      expect((await orgRow()).name).toBe("Acme Corp");
    });
  });

  // ── Concurrency ─────────────────────────────────────────────────────

  it("concurrent renames each record the name they replaced; the last writer wins", async () => {
    const [a, b] = await Promise.all([
      patch({ name: "Name A" }),
      patch({ name: "Name B" }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const rows = await eventually(async () => {
      const r = await auditRows();
      return r.length === 2 ? r : null;
    });
    expect(rows).toHaveLength(2);
    const changes = rows!.map(
      (r) => r.metadata as { from: string; to: string }
    );
    // The writes serialized: one replaced the original, the other replaced
    // the first one's result, and the row holds the second one's name.
    const first = changes.find((c) => c.from === ORIGINAL)!;
    const second = changes.find((c) => c.from !== ORIGINAL)!;
    expect(first).toBeDefined();
    expect(second.from).toBe(first.to);
    expect((await orgRow()).name).toBe(second.to);
  });
});
