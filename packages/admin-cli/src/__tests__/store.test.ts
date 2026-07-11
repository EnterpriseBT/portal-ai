import { createAdminStore } from "../store.js";
import { organizations, organizationUsers, users } from "../tables.js";
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
