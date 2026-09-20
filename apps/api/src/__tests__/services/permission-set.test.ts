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
  role,
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
