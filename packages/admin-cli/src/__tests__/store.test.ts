import { createAdminStore } from "../store.js";
import { organizations, organizationUsers, tiers, users } from "../tables.js";
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
  rowBase({ name, timezone: "UTC", ownerUserId: "u-owner", tier: "standard", defaultStationId: null, ...over });
const user = (email: string, over: Record<string, unknown> = {}) =>
  rowBase({ auth0Id: `auth0|${email}`, email, name: email.split("@")[0], picture: null, lastLogin: null, ...over });
const membership = (organizationId: string, userId: string, over: Record<string, unknown> = {}) =>
  rowBase({ organizationId, userId, lastLogin: null, ...over });

describe("listOrgs", () => {
  it("filters soft-deleted, searches by name, orders created desc, paginates", async () => {
    await t.db.insert(organizations).values([
      org("Acme Alpha", { id: "o-1", created: 1000 }) as never,
      org("Acme Beta", { id: "o-2", created: 3000 }) as never,
      org("Zed Corp", { id: "o-3", created: 2000 }) as never,
      org("Acme Deleted", { id: "o-4", created: 4000, deleted: 4100, deletedBy: "x" }) as never,
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
    await t.db.insert(organizations).values([
      org("Live", { id: "o-live" }) as never,
      org("Gone", { id: "o-gone", deleted: 1, deletedBy: "x" }) as never,
    ]);

    await expect(store.getOrg("o-live")).resolves.toMatchObject({
      id: "o-live",
      name: "Live",
      tier: "standard",
    });
    await expect(store.getOrg("o-missing")).rejects.toBeInstanceOf(AdminNotFoundError);
    await expect(store.getOrg("o-gone")).rejects.toMatchObject({
      code: "ADMIN_NOT_FOUND",
    });
  });
});

describe("listUsers", () => {
  it("without orgId lists live users; with orgId filters via LIVE membership", async () => {
    await t.db.insert(users).values([
      user("a@x.io", { id: "u-a" }) as never,
      user("b@x.io", { id: "u-b" }) as never,
      user("c@x.io", { id: "u-c", deleted: 1, deletedBy: "x" }) as never,
    ]);
    await t.db.insert(organizations).values([org("Org", { id: "o-1" }) as never]);
    await t.db.insert(organizationUsers).values([
      membership("o-1", "u-a", { id: "m-1" }) as never,
      membership("o-1", "u-b", { id: "m-2", deleted: 1, deletedBy: "x" }) as never, // removed member
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
    await t.db.insert(organizations).values([org("Old Name", { id: "o-1" }) as never]);
    const out = await store.updateOrg("o-1", { name: "New Name" }, "actor-1");
    expect(out.name).toBe("New Name");
    expect(out.updatedBy).toBe("actor-1");
    expect(out.updated).toBeGreaterThan(0);
    await expect(
      store.updateOrg("o-none", { name: "x" }, "actor-1")
    ).rejects.toBeInstanceOf(AdminNotFoundError);
  });
});

describe("setTier", () => {
  it("validates the tier exists live, returns previousTier, updates", async () => {
    await t.db.insert(tiers).values([rowBase({ id: "t-1", slug: "premium" }) as never]);
    await t.db.insert(organizations).values([org("Org", { id: "o-1" }) as never]);

    const out = await store.setTier("o-1", "premium", "actor-1");
    expect(out).toEqual({ id: "o-1", tier: "premium", previousTier: "standard" });
    await expect(store.getOrg("o-1")).resolves.toMatchObject({ tier: "premium" });

    await expect(store.setTier("o-1", "no-such-tier", "actor-1")).rejects.toMatchObject({
      code: "ADMIN_NOT_FOUND",
      message: expect.stringMatching(/tier/i),
    });
  });
});

describe("softDeleteOrg", () => {
  it("stamps deleted/deletedBy; an already-deleted org → 8", async () => {
    await t.db.insert(organizations).values([org("Org", { id: "o-1" }) as never]);
    await store.softDeleteOrg("o-1", "actor-1");
    await expect(store.getOrg("o-1")).rejects.toBeInstanceOf(AdminNotFoundError);
    await expect(store.softDeleteOrg("o-1", "actor-1")).rejects.toBeInstanceOf(
      AdminNotFoundError
    );
  });
});

describe("membership", () => {
  beforeEach(async () => {
    await t.db.insert(organizations).values([org("Org", { id: "o-1" }) as never]);
    await t.db.insert(users).values([user("a@x.io", { id: "u-a" }) as never]);
  });

  it("addMember creates a factory-valid row; live duplicate → 9; soft-deleted → revive", async () => {
    await store.addMember("o-1", "u-a", "actor-1");
    let members = await store.listUsers({ orgId: "o-1" });
    expect(members.map((u) => u.id)).toEqual(["u-a"]);

    await expect(store.addMember("o-1", "u-a", "actor-1")).rejects.toMatchObject({
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

  it("removeMember on an absent membership → 8", async () => {
    await expect(store.removeMember("o-1", "u-a", "actor-1")).rejects.toBeInstanceOf(
      AdminNotFoundError
    );
  });

  it("switchMember bumps the live membership's lastLogin (the app's current-org selector)", async () => {
    await store.addMember("o-1", "u-a", "actor-1");
    await store.switchMember("o-1", "u-a", "actor-1");
    const [row] = await t.db.select().from(organizationUsers);
    expect(row.lastLogin).toBeGreaterThan(0);

    await expect(store.switchMember("o-1", "u-none", "actor-1")).rejects.toBeInstanceOf(
      AdminNotFoundError
    );
  });
});

describe("getUserByEmail", () => {
  it("resolves live users only; unknown → ADMIN_NOT_FOUND", async () => {
    await t.db.insert(users).values([
      user("ben@portalsai.io", { id: "u-ben" }) as never,
      user("ghost@x.io", { id: "u-ghost", deleted: 1, deletedBy: "x" }) as never,
    ]);
    await expect(store.getUserByEmail("ben@portalsai.io")).resolves.toMatchObject({
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
