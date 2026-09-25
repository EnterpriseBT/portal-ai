import { describe, it, expect } from "@jest/globals";

import { PermissionSet } from "../../services/permission-set.js";
import { SEED_SYSTEM_POLICIES } from "../../services/seed.service.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { SystemUtilities } from "../../utils/system.util.js";
import { stations } from "../../db/schema/index.js";
import type { PermissionContext } from "../../services/permission.service.js";
import type { PermissionStatementSelect } from "../../db/schema/zod.js";

const SYSTEM = SystemUtilities.id.system;
const ctx = (role: "owner" | "admin" | "member"): PermissionContext => ({
  userId: "user-1",
  organizationId: "org-1",
  roles: [role],
});

let seq = 0;
const S = (p: Partial<PermissionStatementSelect>): PermissionStatementSelect =>
  ({
    id: `s${seq++}`,
    organizationId: "org-1",
    policyId: "p",
    effect: "allow",
    verb: "read",
    resourceType: "station",
    resourceId: null,
    condition: null,
    created: 1,
    createdBy: SYSTEM,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...p,
  }) as PermissionStatementSelect;

const obj = (createdBy: string, id = "st-1") => ({
  type: "station",
  id,
  createdBy,
});

describe("PermissionSet — evaluation (spec cases 3–6, 12)", () => {
  it("deny beats allow regardless of specificity (case 3)", () => {
    const set = new PermissionSet(ctx("member"), [
      S({
        effect: "allow",
        verb: "read",
        resourceType: "station",
        resourceId: null,
      }),
      S({
        effect: "deny",
        verb: "read",
        resourceType: "station",
        resourceId: "st-1",
      }),
    ]);
    expect(set.can("resource.read", obj("user-1", "st-1"))).toBe(false); // deny wins
    expect(set.can("resource.read", obj("user-1", "st-2"))).toBe(true); // only allow
  });

  it("ownership condition gates by createdBy (case 4)", () => {
    const set = new PermissionSet(ctx("member"), [
      S({ verb: "read", condition: "created_by_caller" }),
      S({ verb: "write", condition: "created_by_caller" }),
      S({ verb: "read", condition: "created_by_system" }),
    ]);
    expect(set.can("resource.read", obj("user-1"))).toBe(true); // own
    expect(set.can("resource.read", obj("user-2"))).toBe(false); // other's
    expect(set.can("resource.read", obj(SYSTEM))).toBe(true); // system row
    expect(set.can("resource.write", obj("user-1"))).toBe(true); // own
    expect(set.can("resource.write", obj(SYSTEM))).toBe(false); // no write-system stmt
  });

  it("explicit deny overrides an ownership allow (case 5)", () => {
    const set = new PermissionSet(ctx("member"), [
      S({ verb: "write", condition: "created_by_caller" }),
      S({
        effect: "deny",
        verb: "write",
        resourceType: "station",
        resourceId: "st-1",
      }),
    ]);
    // The caller owns st-1, but the explicit deny wins (an admin froze it).
    expect(set.can("resource.write", obj("user-1", "st-1"))).toBe(false);
    expect(set.can("resource.write", obj("user-1", "st-2"))).toBe(true);
  });

  it("check throws on deny, returns on allow; can mirrors it (case 6)", () => {
    const set = new PermissionSet(ctx("member"), [
      S({ verb: "read", condition: "created_by_caller" }),
    ]);
    expect(() => set.check("resource.read", obj("user-1"))).not.toThrow();
    expect(() => set.check("resource.read", obj("user-2"))).toThrow(ApiError);
    expect(set.can("resource.read", obj("user-2"))).toBe(false);
  });

  it("an empty set denies everything — fail-closed (case 12)", () => {
    const set = new PermissionSet(ctx("member"), []);
    expect(set.can("resource.read", obj("user-1"))).toBe(false);
    expect(set.can("billing.manage")).toBe(false);
    expect(() => set.check("org.delete")).toThrow(ApiError);
  });

  it("check throws the mapped ApiCode per action (deny-code parity with #576)", () => {
    const set = new PermissionSet(ctx("member"), []); // denies everything
    const expectCode = (
      action: Parameters<PermissionSet["check"]>[0],
      code: ApiCode
    ) => {
      try {
        set.check(action);
        throw new Error("expected a deny");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(403);
        expect((err as ApiError).code).toBe(code);
      }
    };
    expectCode("billing.manage", ApiCode.BILLING_NOT_OWNER);
    expectCode("org.delete", ApiCode.ORGANIZATION_NOT_OWNER);
    expectCode("org.audit.read", ApiCode.AUDIT_LOG_NOT_AUTHORIZED);
    expectCode("member.role.assign", ApiCode.INSUFFICIENT_ROLE);
  });
});

describe("PermissionSet — visibilityPredicate shapes (spec case 7)", () => {
  const cols = { createdByCol: stations.createdBy, idCol: stations.id };

  it("returns undefined for an unconditional class-level allow (see all)", () => {
    const set = new PermissionSet(ctx("owner"), [
      S({
        effect: "allow",
        verb: "*",
        resourceType: "*",
        resourceId: null,
        condition: null,
      }),
    ]);
    expect(set.visibilityPredicate("station", cols)).toBeUndefined();
  });

  it("returns a predicate for owner-conditional allows", () => {
    const set = new PermissionSet(ctx("member"), [
      S({ verb: "read", condition: "created_by_caller" }),
      S({ verb: "read", condition: "created_by_system" }),
    ]);
    expect(set.visibilityPredicate("station", cols)).toBeDefined();
  });

  it("returns a predicate for instance allows, and a matches-nothing predicate when no allow applies", () => {
    const instance = new PermissionSet(ctx("member"), [
      S({ verb: "read", resourceType: "station", resourceId: "st-9" }),
    ]);
    expect(instance.visibilityPredicate("station", cols)).toBeDefined();

    // No read statement for this type ⇒ fail-closed (a defined false predicate,
    // not `undefined` which would mean "see all").
    const nothing = new PermissionSet(ctx("member"), [
      S({ verb: "write", condition: "created_by_caller" }),
    ]);
    expect(nothing.visibilityPredicate("station", cols)).toBeDefined();
  });
});

describe("PermissionSet — switch parity (spec case 8)", () => {
  // Build a role's effective set from the seeded system policies.
  const setFor = (role: "owner" | "admin" | "member") => {
    const statements = SEED_SYSTEM_POLICIES.filter(
      (p) => p.role === role
    ).flatMap((p) =>
      p.statements.map((st) =>
        S({
          effect: st.effect,
          verb: st.verb,
          resourceType: st.resourceType,
          resourceId: null,
          condition: st.condition,
        })
      )
    );
    return new PermissionSet(ctx(role), statements);
  };

  // The pre-#598 switch semantics, as fixed expectations (NOT a call into the
  // retired resolveEffect — so this survives its deletion in slice 4).
  type Case = [
    Parameters<PermissionSet["can"]>[0],
    Parameters<PermissionSet["can"]>[1],
    { owner: boolean; admin: boolean; member: boolean },
  ];
  const own = obj("user-1");
  const other = obj("user-2");
  const system = obj(SYSTEM);
  const cases: Case[] = [
    ["billing.manage", undefined, { owner: true, admin: false, member: false }],
    ["org.delete", undefined, { owner: true, admin: false, member: false }],
    ["org.audit.read", undefined, { owner: true, admin: true, member: false }],
    [
      "member.role.assign",
      undefined,
      { owner: true, admin: true, member: false },
    ],
    ["member.invite", undefined, { owner: true, admin: true, member: false }],
    ["member.remove", undefined, { owner: true, admin: true, member: false }],
    ["resource.read", own, { owner: true, admin: true, member: true }],
    ["resource.read", other, { owner: true, admin: true, member: false }],
    ["resource.read", system, { owner: true, admin: true, member: true }],
    ["resource.write", own, { owner: true, admin: true, member: true }],
    ["resource.write", other, { owner: true, admin: true, member: false }],
    ["resource.write", system, { owner: true, admin: true, member: false }],
  ];

  const sets = {
    owner: setFor("owner"),
    admin: setFor("admin"),
    member: setFor("member"),
  };

  it.each(cases)(
    "%s (%o) resolves per the #576 switch for every role",
    (action, object, expected) => {
      expect(sets.owner.can(action, object)).toBe(expected.owner);
      expect(sets.admin.can(action, object)).toBe(expected.admin);
      expect(sets.member.can(action, object)).toBe(expected.member);
    }
  );
});

describe("PermissionSet — assertWithinBoundary (#621)", () => {
  it("passes when every granted verb is within the granter's own set", () => {
    const set = new PermissionSet(ctx("member"), [
      S({ verb: "read", condition: "created_by_caller" }),
      S({ verb: "write", condition: "created_by_caller" }),
    ]);
    expect(() =>
      set.assertWithinBoundary(obj("user-1"), ["read"])
    ).not.toThrow();
    expect(() =>
      set.assertWithinBoundary(obj("user-1"), ["read", "write"])
    ).not.toThrow();
  });

  it("throws RBAC_GRANT_EXCEEDS_BOUNDARY for a verb outside the granter's set", () => {
    const set = new PermissionSet(ctx("member"), [
      S({ verb: "read", condition: "created_by_caller" }),
    ]);
    try {
      set.assertWithinBoundary(obj("user-1"), ["write"]);
      throw new Error("expected a boundary throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
      expect((err as ApiError).code).toBe(ApiCode.RBAC_GRANT_EXCEEDS_BOUNDARY);
    }
  });

  it("an owner (allow * *) is within boundary for any verb on any object", () => {
    const set = new PermissionSet(ctx("owner"), [
      S({ verb: "*", resourceType: "*", condition: null }),
    ]);
    expect(() =>
      set.assertWithinBoundary(obj("someone-else"), ["read", "write"])
    ).not.toThrow();
  });
});

// ── assertStatementsWithinBoundary (#622 slice 2) ─────────────────────

describe("PermissionSet.assertStatementsWithinBoundary (#622)", () => {
  const ownerSet = () =>
    new PermissionSet(ctx("owner"), [S({ verb: "*", resourceType: "*" })]);
  const adminSet = () =>
    new PermissionSet(ctx("admin"), [
      S({ verb: "*", resourceType: "*" }),
      S({ effect: "deny", verb: "manage", resourceType: "billing" }),
    ]);
  const memberSet = () =>
    new PermissionSet(ctx("member"), [
      S({
        verb: "read",
        resourceType: "station",
        condition: "created_by_caller",
      }),
      S({
        verb: "write",
        resourceType: "station",
        condition: "created_by_caller",
      }),
      S({
        verb: "read",
        resourceType: "station",
        condition: "created_by_system",
      }),
    ]);

  // Stub object resolver: map resourceId → its real createdBy (null = absent).
  const resolver =
    (map: Record<string, string | null>) =>
    async (_rt: string, rid: string): Promise<string | null> =>
      rid in map ? map[rid] : null;
  const noObjects = resolver({});

  const boundary = { code: ApiCode.RBAC_POLICY_EXCEEDS_BOUNDARY };

  // ── class-level ──
  it("owner (* *) can author any statement, including allow * *", async () => {
    await expect(
      ownerSet().assertStatementsWithinBoundary(
        [S({ verb: "*", resourceType: "*" })],
        noObjects
      )
    ).resolves.toBeUndefined();
  });

  it("admin is rejected for allow * * (the billing deny is out of boundary)", async () => {
    await expect(
      adminSet().assertStatementsWithinBoundary(
        [S({ verb: "*", resourceType: "*" })],
        noObjects
      )
    ).rejects.toMatchObject(boundary);
  });

  it("admin is rejected for allow manage billing", async () => {
    await expect(
      adminSet().assertStatementsWithinBoundary(
        [S({ verb: "manage", resourceType: "billing" })],
        noObjects
      )
    ).rejects.toMatchObject(boundary);
  });

  it("admin can author an admin-equivalent bundle (read station + invite member)", async () => {
    await expect(
      adminSet().assertStatementsWithinBoundary(
        [
          S({ verb: "read", resourceType: "station" }),
          S({ verb: "invite", resourceType: "member" }),
        ],
        noObjects
      )
    ).resolves.toBeUndefined();
  });

  it("member can author its own-scoped allow (read station created_by_caller)", async () => {
    await expect(
      memberSet().assertStatementsWithinBoundary(
        [
          S({
            verb: "read",
            resourceType: "station",
            condition: "created_by_caller",
          }),
        ],
        noObjects
      )
    ).resolves.toBeUndefined();
  });

  it("member is rejected for the unconditional allow read station", async () => {
    await expect(
      memberSet().assertStatementsWithinBoundary(
        [S({ verb: "read", resourceType: "station", condition: null })],
        noObjects
      )
    ).rejects.toMatchObject(boundary);
  });

  it("member is rejected for read audit (a capability it lacks)", async () => {
    await expect(
      memberSet().assertStatementsWithinBoundary(
        [S({ verb: "read", resourceType: "audit" })],
        noObjects
      )
    ).rejects.toMatchObject(boundary);
  });

  it("a deny statement is always in-boundary, even one the author couldn't allow", async () => {
    await expect(
      memberSet().assertStatementsWithinBoundary(
        [
          S({
            effect: "deny",
            verb: "read",
            resourceType: "station",
            condition: null,
          }),
        ],
        noObjects
      )
    ).resolves.toBeUndefined();
  });

  it("a wildcard verb fans out — member can't author allow * station (lacks delete)", async () => {
    await expect(
      memberSet().assertStatementsWithinBoundary(
        [
          S({
            verb: "*",
            resourceType: "station",
            condition: "created_by_caller",
          }),
        ],
        noObjects
      )
    ).rejects.toMatchObject(boundary);
  });

  // ── instance-level (via the resolver) ──
  it("member can grant read on an instance it created (created_by_caller covers)", async () => {
    await expect(
      memberSet().assertStatementsWithinBoundary(
        [S({ verb: "read", resourceType: "station", resourceId: "st-mine" })],
        resolver({ "st-mine": "user-1" }) // caller created it
      )
    ).resolves.toBeUndefined();
  });

  it("member cannot grant read on an instance someone else created", async () => {
    await expect(
      memberSet().assertStatementsWithinBoundary(
        [S({ verb: "read", resourceType: "station", resourceId: "st-other" })],
        resolver({ "st-other": "other-user" })
      )
    ).rejects.toMatchObject(boundary);
  });

  it("owner's class allow covers any instance grant", async () => {
    await expect(
      ownerSet().assertStatementsWithinBoundary(
        [S({ verb: "read", resourceType: "station", resourceId: "st-other" })],
        resolver({ "st-other": "other-user" })
      )
    ).resolves.toBeUndefined();
  });

  it("an unresolvable/absent instance object rejects", async () => {
    await expect(
      ownerSet().assertStatementsWithinBoundary(
        [S({ verb: "read", resourceType: "station", resourceId: "gone" })],
        noObjects // resolver returns null
      )
    ).rejects.toMatchObject(boundary);
  });

  // ── #630: instance-level `page` (ownershipless) is class-probed, not
  //    resolved against a (nonexistent) object creator. ──
  it("owner (* *) can author an instance `view page:<id>` grant (no resolver call)", async () => {
    await expect(
      ownerSet().assertStatementsWithinBoundary(
        [
          S({
            verb: "view",
            resourceType: "page",
            resourceId: "connectors",
          }),
        ],
        noObjects // page must NOT go through resolveCreatedBy (would reject)
      )
    ).resolves.toBeUndefined();
  });

  it("a `view page:*` holder can author any specific page grant", async () => {
    const set = new PermissionSet(ctx("member"), [
      S({ verb: "view", resourceType: "page", resourceId: null }),
    ]);
    await expect(
      set.assertStatementsWithinBoundary(
        [S({ verb: "view", resourceType: "page", resourceId: "toolpacks" })],
        noObjects
      )
    ).resolves.toBeUndefined();
  });

  it("a holder of only `view page:stations` cannot author `view page:connectors`", async () => {
    const set = new PermissionSet(ctx("member"), [
      S({ verb: "view", resourceType: "page", resourceId: "stations" }),
    ]);
    await expect(
      set.assertStatementsWithinBoundary(
        [S({ verb: "view", resourceType: "page", resourceId: "stations" })],
        noObjects
      )
    ).resolves.toBeUndefined();
    await expect(
      set.assertStatementsWithinBoundary(
        [S({ verb: "view", resourceType: "page", resourceId: "connectors" })],
        noObjects
      )
    ).rejects.toMatchObject(boundary);
  });
});

// ── Page view + class-vs-object composition (#630) ───────────────────

describe("PermissionSet — page view + composable surfaces (#630)", () => {
  const page = (id: string) => ({ type: "page", id });

  it("view page:<id> is allowed only for the granted id (class-level implicit-deny)", () => {
    const set = new PermissionSet(ctx("member"), [
      S({ verb: "view", resourceType: "page", resourceId: "stations" }),
      S({ verb: "view", resourceType: "page", resourceId: "jobs" }),
    ]);
    expect(set.can("resource.view", page("stations"))).toBe(true);
    expect(set.can("resource.view", page("jobs"))).toBe(true);
    expect(set.can("resource.view", page("connectors"))).toBe(false); // ungranted
  });

  it("a `deny read <class>` overrides an `allow read <object>`; page view is unaffected", () => {
    const set = new PermissionSet(ctx("member"), [
      // object surface: an allow on a specific connector, denied at the class.
      S({
        effect: "allow",
        verb: "read",
        resourceType: "connector_instance",
        resourceId: "ci-1",
      }),
      S({
        effect: "deny",
        verb: "read",
        resourceType: "connector_instance",
        resourceId: null,
      }),
      // page surface: an independent view grant on the Connectors page.
      S({ verb: "view", resourceType: "page", resourceId: "connectors" }),
    ]);
    // Deny-over-allow on the object class (conventional RBAC).
    expect(
      set.can("resource.read", {
        type: "connector_instance",
        id: "ci-1",
        createdBy: "user-1",
      })
    ).toBe(false);
    // The page is a different resource — the object deny doesn't touch it.
    expect(set.can("resource.view", page("connectors"))).toBe(true);
  });

  it("the wildcard set (owner) views every nav page", () => {
    const set = new PermissionSet(ctx("owner"), [
      S({ verb: "*", resourceType: "*" }),
    ]);
    for (const id of [
      "connectors",
      "connector_catalog",
      "toolpacks",
      "stations",
    ])
      expect(set.can("resource.view", page(id))).toBe(true);
  });
});
