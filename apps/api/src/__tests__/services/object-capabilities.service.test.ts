import { describe, it, expect } from "@jest/globals";

import { PermissionSet } from "../../services/permission-set.js";
import { ObjectCapabilitiesService } from "../../services/object-capabilities.service.js";
import { SEED_SYSTEM_POLICIES } from "../../services/seed.service.js";
import { SystemUtilities } from "../../utils/system.util.js";
import type { PermissionContext } from "../../services/permission.service.js";
import type { PermissionStatementSelect } from "../../db/schema/zod.js";

/**
 * #688: a payload row's capabilities are the same `PermissionSet.can` the
 * mutation routes `check`, evaluated over the seeded system policies.
 */
const SYSTEM = SystemUtilities.id.system;
const USER = "user-1";

let seq = 0;
const setFor = (role: "owner" | "member"): PermissionSet => {
  const ctx: PermissionContext = {
    userId: USER,
    organizationId: "org-1",
    roles: [role],
  };
  const statements = SEED_SYSTEM_POLICIES.filter(
    (p) => p.role === role
  ).flatMap((p) =>
    p.statements.map(
      (st) =>
        ({
          id: `s${seq++}`,
          organizationId: "org-1",
          policyId: "p",
          effect: st.effect,
          verb: st.verb,
          resourceType: st.resourceType,
          resourceId: null,
          condition: st.condition,
          conditionParam: null,
          created: 1,
          createdBy: SYSTEM,
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        }) as PermissionStatementSelect
    )
  );
  return new PermissionSet(ctx, statements);
};

describe("ObjectCapabilitiesService (#688)", () => {
  it("the owner can do everything to any row, and share a shareable one", () => {
    expect(
      ObjectCapabilitiesService.for(setFor("owner"), "station", {
        id: "st-1",
        createdBy: "someone-else",
      })
    ).toEqual({ read: true, write: true, delete: true, share: true });
  });

  it("a member can do everything to their own row", () => {
    expect(
      ObjectCapabilitiesService.for(setFor("member"), "portal", {
        id: "p-1",
        createdBy: USER,
      })
    ).toEqual({ read: true, write: true, delete: true });
  });

  it("a member only reads a system-created row", () => {
    expect(
      ObjectCapabilitiesService.for(setFor("member"), "connector_instance", {
        id: "ci-1",
        createdBy: SYSTEM,
      })
    ).toEqual({ read: true, write: false, delete: false });
  });

  it("a member can't read, write or delete another member's row", () => {
    expect(
      ObjectCapabilitiesService.for(setFor("member"), "entity", {
        id: "e-1",
        createdBy: "another-member",
      })
    ).toEqual({ read: false, write: false, delete: false });
  });

  it("share is present exactly for the shareable types", () => {
    const set = setFor("owner");
    const row = { id: "x", createdBy: USER };
    for (const type of ["station", "pin", "curated_view"] as const) {
      expect(ObjectCapabilitiesService.for(set, type, row)).toHaveProperty(
        "share"
      );
    }
    for (const type of [
      "portal",
      "connector_instance",
      "entity",
      "entity_record",
      "field_mapping",
      "tag",
      "entity_group",
      "column_definition",
      "toolpack",
    ] as const) {
      expect(ObjectCapabilitiesService.for(set, type, row)).not.toHaveProperty(
        "share"
      );
    }
  });

  it("attach keeps every row and its fields, in order", () => {
    const rows = [
      { id: "a", createdBy: USER, name: "A" },
      { id: "b", createdBy: SYSTEM, name: "B" },
    ];
    const out = ObjectCapabilitiesService.attach(
      setFor("member"),
      "station",
      rows
    );
    expect(out.map((r) => [r.id, r.name])).toEqual([
      ["a", "A"],
      ["b", "B"],
    ]);
    expect(out[0].capabilities).toEqual({
      read: true,
      write: true,
      delete: true,
      share: true,
    });
    expect(out[1].capabilities.write).toBe(false);
  });

  it("a builtin toolpack is read-only, even to the owner", () => {
    expect(
      ObjectCapabilitiesService.forToolpack(setFor("owner"), {
        id: "builtin:data_query",
        kind: "builtin",
      })
    ).toEqual({ read: true, write: false, delete: false });
  });

  it("a custom toolpack is computed from its createdBy", () => {
    expect(
      ObjectCapabilitiesService.forToolpack(setFor("owner"), {
        id: "tp-1",
        kind: "custom",
        createdBy: "someone",
      })
    ).toEqual({ read: true, write: true, delete: true });
    expect(
      ObjectCapabilitiesService.forToolpack(setFor("member"), {
        id: "tp-1",
        kind: "custom",
        createdBy: "someone",
      })
    ).toEqual({ read: false, write: false, delete: false });
  });
});
