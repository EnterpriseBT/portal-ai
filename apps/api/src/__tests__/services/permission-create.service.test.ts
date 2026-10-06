import { describe, it, expect } from "@jest/globals";

import { RESOURCE_PERMISSION_TYPES } from "@portalai/core/models";

import { PermissionSet } from "../../services/permission-set.js";
import { PermissionService } from "../../services/permission.service.js";
import { SEED_SYSTEM_POLICIES } from "../../services/seed.service.js";
import { SystemUtilities } from "../../utils/system.util.js";
import type { PermissionContext } from "../../services/permission.service.js";
import type { PermissionStatementSelect } from "../../db/schema/zod.js";

/**
 * #708: `create` on each resourcePermissions entry is the type's create
 * route's own check (`CREATE_RULES`), not `canPerformAny`. So it honours
 * conditions, instance scope and denies, which the any-grant `write` signal
 * doesn't.
 */
const SYSTEM = SystemUtilities.id.system;
const USER = "user-1";
const ctxFor = (roles: ("owner" | "member")[]): PermissionContext => ({
  userId: USER,
  organizationId: "org-1",
  roles,
});

let seq = 0;
type St = Pick<
  PermissionStatementSelect,
  "effect" | "verb" | "resourceType" | "resourceId" | "condition"
>;
const statement = (st: St): PermissionStatementSelect =>
  ({
    id: `s${seq++}`,
    organizationId: "org-1",
    policyId: "p",
    conditionParam: null,
    created: 1,
    createdBy: SYSTEM,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...st,
  }) as PermissionStatementSelect;

const seeded = (role: "owner" | "member"): PermissionStatementSelect[] =>
  SEED_SYSTEM_POLICIES.filter((p) => p.role === role).flatMap((p) =>
    p.statements.map((st) =>
      statement({
        effect: st.effect,
        verb: st.verb,
        resourceType: st.resourceType,
        resourceId: null,
        condition: st.condition,
      })
    )
  );

/** A caller holding only `extra` (no seeded role policy). */
const custom = (...extra: St[]) => {
  const ctx = ctxFor([]);
  return { ctx, set: new PermissionSet(ctx, extra.map(statement)) };
};
const create = (
  { ctx, set }: { ctx: PermissionContext; set: PermissionSet },
  type: (typeof RESOURCE_PERMISSION_TYPES)[number]
) => PermissionService.canCreate(ctx, set, type);

const CLASS_TYPES = [
  "curated_view",
  "entity_group",
  "tag",
  "column_definition",
  "toolpack",
] as const;
const OWNED_TYPES = [
  "station",
  "pin",
  "portal",
  "entity",
  "entity_record",
  "field_mapping",
  "connector_instance",
] as const;
const NONE_TYPES = ["connector_definition", "job"] as const;

describe("PermissionService.canCreate (#708)", () => {
  it("the rule table covers every resource type exactly once", () => {
    expect([...CLASS_TYPES, ...OWNED_TYPES, ...NONE_TYPES].sort()).toEqual(
      [...RESOURCE_PERMISSION_TYPES].sort()
    );
  });

  // Spec case 3.
  it("the owner may create every creatable type, and no system-created one", () => {
    const ctx = ctxFor(["owner"]);
    const caller = { ctx, set: new PermissionSet(ctx, seeded("owner")) };
    for (const t of [...CLASS_TYPES, ...OWNED_TYPES])
      expect([t, create(caller, t)]).toEqual([t, true]);
    for (const t of NONE_TYPES)
      expect([t, create(caller, t)]).toEqual([t, false]);
  });

  // Spec case 4: the seeded member, including the curated-view bug.
  it("a seeded member may create the owned types, and none of the class ones", () => {
    const ctx = ctxFor(["member"]);
    const caller = { ctx, set: new PermissionSet(ctx, seeded("member")) };
    for (const t of OWNED_TYPES)
      expect([t, create(caller, t)]).toEqual([t, true]);
    for (const t of CLASS_TYPES)
      expect([t, create(caller, t)]).toEqual([t, false]);
    // The seeded grant `write curated_view created_by_caller` makes the
    // any-grant `write` true, which is what Create View used to read.
    expect(caller.set.canPerformAny("write", "curated_view")).toBe(true);
  });

  // Spec case 5.
  it("an owned-only grant doesn't satisfy a class create", () => {
    const caller = custom({
      effect: "allow",
      verb: "write",
      resourceType: "tag",
      resourceId: null,
      condition: "created_by_caller",
    });
    expect(caller.set.canPerformAny("write", "tag")).toBe(true);
    expect(create(caller, "tag")).toBe(false);
  });

  // Spec case 6.
  it("an instance-only grant doesn't satisfy an owned create", () => {
    const caller = custom({
      effect: "allow",
      verb: "write",
      resourceType: "connector_instance",
      resourceId: "ci-1",
      condition: null,
    });
    expect(caller.set.canPerformAny("write", "connector_instance")).toBe(true);
    expect(create(caller, "connector_instance")).toBe(false);
  });

  // Spec case 7.
  it("a created_by_system-only grant doesn't satisfy an owned create", () => {
    const caller = custom({
      effect: "allow",
      verb: "write",
      resourceType: "pin",
      resourceId: null,
      condition: "created_by_system",
    });
    expect(caller.set.canPerformAny("write", "pin")).toBe(true);
    expect(create(caller, "pin")).toBe(false);
  });

  // Spec case 8.
  it("a conditional deny beside the allow refuses the owned create", () => {
    const caller = custom(
      {
        effect: "allow",
        verb: "write",
        resourceType: "entity",
        resourceId: null,
        condition: "created_by_caller",
      },
      {
        effect: "deny",
        verb: "write",
        resourceType: "entity",
        resourceId: null,
        condition: "created_by_caller",
      }
    );
    expect(caller.set.canPerformAny("write", "entity")).toBe(true);
    expect(create(caller, "entity")).toBe(false);
  });

  it("an owned-only grant does satisfy an owned create", () => {
    const caller = custom({
      effect: "allow",
      verb: "write",
      resourceType: "field_mapping",
      resourceId: null,
      condition: "created_by_caller",
    });
    expect(create(caller, "field_mapping")).toBe(true);
  });

  // Spec case 9.
  it("system-created types are never creatable, even under `* *`", () => {
    const caller = custom({
      effect: "allow",
      verb: "*",
      resourceType: "*",
      resourceId: null,
      condition: null,
    });
    for (const t of NONE_TYPES) expect(create(caller, t)).toBe(false);
    expect(create(caller, "tag")).toBe(true);
  });
});
