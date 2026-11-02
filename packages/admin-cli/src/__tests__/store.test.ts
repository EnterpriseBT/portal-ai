import { desc, eq } from "drizzle-orm";
import { createAdminStore } from "../store.js";
import {
  auditLog,
  organizations,
  organizationUsers,
  stations,
  tiers,
  users,
} from "../tables.js";
import { AdminNotFoundError } from "../errors.js";
import { makeTestDb, rowBase, type TestDb } from "./helpers/test-db.js";

let t: TestDb;
let store: ReturnType<typeof createAdminStore>;

beforeEach(async () => {
  t = await makeTestDb();
  store = createAdminStore(t.db);
});
afterEach(async () => {
  await t.close();
});

const org = (name: string, over: Record<string, unknown> = {}) =>
  rowBase({
    name,
    timezone: "UTC",
    ownerUserId: "u-owner",
    tier: "standard",
    defaultStationId: null,
    ...over,
  });
const user = (email: string, over: Record<string, unknown> = {}) =>
  rowBase({
    auth0Id: `auth0|${email}`,
    email,
    name: email.split("@")[0],
    picture: null,
    lastLogin: null,
    ...over,
  });
const membership = (
  organizationId: string,
  userId: string,
  over: Record<string, unknown> = {}
) => rowBase({ organizationId, userId, lastLogin: null, ...over });

describe("listOrgs", () => {
  it("filters soft-deleted, searches by name, orders created desc, paginates", async () => {
    await t.db.insert(organizations).values([
      org("Acme Alpha", { id: "o-1", created: 1000 }) as never,
      org("Acme Beta", { id: "o-2", created: 3000 }) as never,
      org("Zed Corp", { id: "o-3", created: 2000 }) as never,
      org("Acme Deleted", {
        id: "o-4",
        created: 4000,
        deleted: 4100,
        deletedBy: "x",
      }) as never,
    ]);

    const all = await store.listOrgs({});
    expect(all.map((o) => o.id)).toEqual(["o-2", "o-3", "o-1"]); // created desc, no deleted

    const acme = await store.listOrgs({ search: "acme" });
    expect(acme.map((o) => o.id)).toEqual(["o-2", "o-1"]); // case-insensitive, deleted excluded

    const page = await store.listOrgs({ limit: 1, offset: 1 });
    expect(page.map((o) => o.id)).toEqual(["o-3"]);
  });
});

describe("getOrg", () => {
  it("returns the live org; missing or soft-deleted → ADMIN_NOT_FOUND", async () => {
    await t.db
      .insert(organizations)
      .values([
        org("Live", { id: "o-live" }) as never,
        org("Gone", { id: "o-gone", deleted: 1, deletedBy: "x" }) as never,
      ]);

    await expect(store.getOrg("o-live")).resolves.toMatchObject({
      id: "o-live",
      name: "Live",
      tier: "standard",
    });
    await expect(store.getOrg("o-missing")).rejects.toBeInstanceOf(
      AdminNotFoundError
    );
    await expect(store.getOrg("o-gone")).rejects.toMatchObject({
      code: "ADMIN_NOT_FOUND",
    });
  });

  // #259: the org set-tier guard reads these; the mirror must project them
  // (the subset parity test does NOT catch an omitted column).
  it("returns the Stripe linkage fields (customer + subscription)", async () => {
    await t.db.insert(organizations).values(
      org("Subbed", {
        id: "o-sub",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_live_1",
      }) as never
    );

    await expect(store.getOrg("o-sub")).resolves.toMatchObject({
      id: "o-sub",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_live_1",
    });
  });
});

describe("listUsers", () => {
  it("without orgId lists live users; with orgId filters via LIVE membership", async () => {
    await t.db
      .insert(users)
      .values([
        user("a@x.io", { id: "u-a" }) as never,
        user("b@x.io", { id: "u-b" }) as never,
        user("c@x.io", { id: "u-c", deleted: 1, deletedBy: "x" }) as never,
      ]);
    await t.db
      .insert(organizations)
      .values([org("Org", { id: "o-1" }) as never]);
    await t.db.insert(organizationUsers).values([
      membership("o-1", "u-a", { id: "m-1" }) as never,
      membership("o-1", "u-b", {
        id: "m-2",
        deleted: 1,
        deletedBy: "x",
      }) as never, // removed member
    ]);

    const all = await store.listUsers({});
    expect(all.map((u) => u.id).sort()).toEqual(["u-a", "u-b"]); // deleted user excluded

    const members = await store.listUsers({ orgId: "o-1" });
    expect(members.map((u) => u.id)).toEqual(["u-a"]); // live membership only
  });
});

// ── Slice 2 — mutations ──────────────────────────────────────────────

describe("updateOrg", () => {
  it("patches fields and stamps updated/updatedBy; unknown org → 8", async () => {
    await t.db
      .insert(organizations)
      .values([org("Old Name", { id: "o-1" }) as never]);
    const out = await store.updateOrg("o-1", { name: "New Name" }, "actor-1");
    expect(out.org.name).toBe("New Name");
    expect(out.org.updatedBy).toBe("actor-1");
    expect(out.org.updated).toBeGreaterThan(0);
    await expect(
      store.updateOrg("o-none", { name: "x" }, "actor-1")
    ).rejects.toBeInstanceOf(AdminNotFoundError);
  });
});

// #936: the CLI records the app's org.update entries (#907 rename, #935
// default station) in the same transaction as the change.
describe("updateOrg — audit_log", () => {
  const station = (id: string, organizationId: string, name: string) =>
    rowBase({ id, organizationId, name }) as never;

  const entries = () =>
    t.db.select().from(auditLog).orderBy(auditLog.created, auditLog.id);

  beforeEach(async () => {
    await t.db
      .insert(organizations)
      .values([
        org("Acme", { id: "o-1", defaultStationId: "st-a" }) as never,
        org("Other", { id: "o-2" }) as never,
      ]);
    await t.db.insert(stations).values([
      station("st-a", "o-1", "Main"),
      station("st-b", "o-1", "Sales"),
      station("st-x", "o-2", "Elsewhere"),
      rowBase({
        id: "st-gone",
        organizationId: "o-1",
        name: "Archived",
        deleted: 5,
      }) as never,
    ]);
  });

  it("a rename records org.update { field: name, from, to, via }", async () => {
    const out = await store.updateOrg("o-1", { name: "Acme Corp" }, "actor-1");

    expect(out.changes).toEqual({ name: { from: "Acme", to: "Acme Corp" } });
    const rows = await entries();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: "o-1",
      userId: "actor-1",
      action: "org.update",
      targetType: "organization",
      targetId: "o-1",
      outcome: "success",
      metadata: {
        field: "name",
        from: "Acme",
        to: "Acme Corp",
        via: "portalai",
      },
    });
  });

  it("changing the default station records both ids and names", async () => {
    await store.updateOrg("o-1", { defaultStationId: "st-b" }, "actor-1");

    const rows = await entries();
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toEqual({
      field: "defaultStationId",
      from: "st-a",
      to: "st-b",
      fromName: "Main",
      toName: "Sales",
      via: "portalai",
    });
  });

  it("setting it from none and clearing it record null on the empty side", async () => {
    await store.updateOrg("o-2", { defaultStationId: null }, "actor-1");
    expect(await entries()).toHaveLength(0); // already none: a no-op

    await store.updateOrg("o-1", { defaultStationId: null }, "actor-1");
    const [cleared] = await entries();
    expect(cleared.metadata).toMatchObject({
      from: "st-a",
      to: null,
      fromName: "Main",
      toName: null,
    });
  });

  it("an unchanged value records nothing", async () => {
    await store.updateOrg(
      "o-1",
      { name: "Acme", defaultStationId: "st-a" },
      "actor-1"
    );
    expect(await entries()).toHaveLength(0);
  });

  it("a name and a station change record one entry each", async () => {
    const out = await store.updateOrg(
      "o-1",
      { name: "Acme Corp", defaultStationId: "st-b" },
      "actor-1"
    );
    expect(Object.keys(out.changes).sort()).toEqual([
      "defaultStationId",
      "name",
    ]);
    const fields = (await entries()).map(
      (r) => (r.metadata as { field: string }).field
    );
    expect(fields.sort()).toEqual(["defaultStationId", "name"]);
  });

  it.each([
    ["another org's station", "st-x"],
    ["a deleted station", "st-gone"],
    ["an unknown station", "st-none"],
  ])("%s is ADMIN_NOT_FOUND and writes nothing", async (_label, id) => {
    await expect(
      store.updateOrg("o-1", { name: "Acme Corp", defaultStationId: id }, "a")
    ).rejects.toBeInstanceOf(AdminNotFoundError);

    const [row] = await t.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, "o-1"));
    expect(row.name).toBe("Acme");
    expect(row.defaultStationId).toBe("st-a");
    expect(await entries()).toHaveLength(0);
  });

  it("the actor is the operator's user id when their sub matches a user", async () => {
    await t.db
      .insert(users)
      .values([
        user("op@example.com", { id: "u-op", auth0Id: "auth0|op" }) as never,
      ]);

    await store.updateOrg("o-1", { name: "Acme Corp" }, "auth0|op");

    expect((await entries())[0].userId).toBe("u-op");
  });
});

describe("setTier", () => {
  it("validates the tier exists live, returns previousTier, updates", async () => {
    await t.db
      .insert(tiers)
      .values([rowBase({ id: "t-1", slug: "premium" }) as never]);
    await t.db
      .insert(organizations)
      .values([org("Org", { id: "o-1" }) as never]);

    const out = await store.setTier("o-1", "premium", "actor-1");
    expect(out).toEqual({
      id: "o-1",
      tier: "premium",
      previousTier: "standard",
    });
    await expect(store.getOrg("o-1")).resolves.toMatchObject({
      tier: "premium",
    });

    await expect(
      store.setTier("o-1", "no-such-tier", "actor-1")
    ).rejects.toMatchObject({
      code: "ADMIN_NOT_FOUND",
      message: expect.stringMatching(/tier/i),
    });
  });
});

describe("softDeleteOrg", () => {
  it("stamps deleted/deletedBy; an already-deleted org → 8", async () => {
    await t.db
      .insert(organizations)
      .values([org("Org", { id: "o-1" }) as never]);
    await store.softDeleteOrg("o-1", "actor-1");
    await expect(store.getOrg("o-1")).rejects.toBeInstanceOf(
      AdminNotFoundError
    );
    await expect(store.softDeleteOrg("o-1", "actor-1")).rejects.toBeInstanceOf(
      AdminNotFoundError
    );
  });
});

describe("membership", () => {
  beforeEach(async () => {
    await t.db
      .insert(organizations)
      .values([org("Org", { id: "o-1" }) as never]);
    await t.db.insert(users).values([user("a@x.io", { id: "u-a" }) as never]);
  });

  it("addMember creates a factory-valid row; live duplicate → 9; soft-deleted → revive", async () => {
    await store.addMember("o-1", "u-a", "actor-1");
    let members = await store.listUsers({ orgId: "o-1" });
    expect(members.map((u) => u.id)).toEqual(["u-a"]);

    // lastLogin is 0 (not null) so the new membership never hijacks the
    // user's current-org selector (app orders last_login DESC, NULLS FIRST).
    const [added] = await t.db.select().from(organizationUsers);
    expect(added.lastLogin).toBe(0);

    await expect(
      store.addMember("o-1", "u-a", "actor-1")
    ).rejects.toMatchObject({
      code: "ADMIN_CONFLICT",
    });

    await store.removeMember("o-1", "u-a", "actor-1");
    expect(await store.listUsers({ orgId: "o-1" })).toEqual([]);

    // re-adding revives the soft-deleted row rather than inserting a twin
    await store.addMember("o-1", "u-a", "actor-2");
    members = await store.listUsers({ orgId: "o-1" });
    expect(members.map((u) => u.id)).toEqual(["u-a"]);
    const rows = await t.db.select().from(organizationUsers);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ deleted: null, updatedBy: "actor-2" });
  });

  it("a freshly-added membership does NOT hijack the app's current-org selector (last_login DESC, NULLS FIRST)", async () => {
    // The user already belongs to a real org (stamped at signup).
    await t.db
      .insert(organizations)
      .values([org("Real", { id: "o-real" }) as never]);
    await t.db
      .insert(organizationUsers)
      .values([
        membership("o-real", "u-a", { id: "m-real", lastLogin: 1000 }) as never,
      ]);
    // Admin adds them to a second org.
    await store.addMember("o-1", "u-a", "actor-1");

    // Mirror ApplicationService.getCurrentOrganization: ORDER BY last_login DESC.
    const [current] = await t.db
      .select()
      .from(organizationUsers)
      .where(eq(organizationUsers.userId, "u-a"))
      .orderBy(desc(organizationUsers.lastLogin))
      .limit(1);
    expect(current.organizationId).toBe("o-real"); // NOT the newly-added org

    // …until an explicit switch bumps lastLogin.
    await store.switchMember("o-1", "u-a", "actor-1");
    const [afterSwitch] = await t.db
      .select()
      .from(organizationUsers)
      .where(eq(organizationUsers.userId, "u-a"))
      .orderBy(desc(organizationUsers.lastLogin))
      .limit(1);
    expect(afterSwitch.organizationId).toBe("o-1");
  });

  it("reviving a membership resets lastLogin to 0 so re-add never re-hijacks the current org", async () => {
    await t.db
      .insert(organizations)
      .values([org("Real", { id: "o-real" }) as never]);
    await t.db
      .insert(organizationUsers)
      .values([
        membership("o-real", "u-a", { id: "m-real", lastLogin: 1000 }) as never,
      ]);
    // add → switch INTO o-1 (lastLogin = now) → remove (soft-delete the row).
    await store.addMember("o-1", "u-a", "actor-1");
    await store.switchMember("o-1", "u-a", "actor-1");
    await store.removeMember("o-1", "u-a", "actor-1");
    // re-add revives the row; it must come back with lastLogin 0, NOT the
    // switched-to timestamp — otherwise it would silently win the selector.
    await store.addMember("o-1", "u-a", "actor-2");

    const [revived] = await t.db
      .select()
      .from(organizationUsers)
      .where(eq(organizationUsers.organizationId, "o-1"));
    expect(revived.lastLogin).toBe(0);

    const [current] = await t.db
      .select()
      .from(organizationUsers)
      .where(eq(organizationUsers.userId, "u-a"))
      .orderBy(desc(organizationUsers.lastLogin))
      .limit(1);
    expect(current.organizationId).toBe("o-real"); // NOT the re-added o-1
  });

  it("removeMember on an absent membership → 8", async () => {
    await expect(
      store.removeMember("o-1", "u-a", "actor-1")
    ).rejects.toBeInstanceOf(AdminNotFoundError);
  });

  it("switchMember bumps the live membership's lastLogin (the app's current-org selector)", async () => {
    await store.addMember("o-1", "u-a", "actor-1");
    await store.switchMember("o-1", "u-a", "actor-1");
    const [row] = await t.db.select().from(organizationUsers);
    expect(row.lastLogin).toBeGreaterThan(0);

    await expect(
      store.switchMember("o-1", "u-none", "actor-1")
    ).rejects.toBeInstanceOf(AdminNotFoundError);
  });
});

describe("getUserByEmail", () => {
  it("resolves live users only; unknown → ADMIN_NOT_FOUND", async () => {
    await t.db.insert(users).values([
      user("ben@portalsai.io", { id: "u-ben" }) as never,
      user("ghost@x.io", {
        id: "u-ghost",
        deleted: 1,
        deletedBy: "x",
      }) as never,
    ]);
    await expect(
      store.getUserByEmail("ben@portalsai.io")
    ).resolves.toMatchObject({
      id: "u-ben",
    });
    await expect(store.getUserByEmail("ghost@x.io")).rejects.toBeInstanceOf(
      AdminNotFoundError
    );
    await expect(store.getUserByEmail("nobody@x.io")).rejects.toMatchObject({
      code: "ADMIN_NOT_FOUND",
    });
  });
});
