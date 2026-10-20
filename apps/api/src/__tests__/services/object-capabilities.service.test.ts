import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { PermissionContext } from "../../services/permission.service.js";
import type { PermissionStatementSelect } from "../../db/schema/zod.js";

// #829: a child's capabilities look its parent up.
type ParentRow = { id: string; organizationId: string; createdBy: string };
const mockEntityFindMany = jest.fn<(where: unknown) => Promise<ParentRow[]>>();
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorEntities: { findAuthRows: mockEntityFindMany },
      connectorInstances: { findAuthRows: jest.fn() },
    },
  },
}));

const { PermissionSet } = await import("../../services/permission-set.js");
const { ObjectCapabilitiesService } =
  await import("../../services/object-capabilities.service.js");
const { SEED_SYSTEM_POLICIES } = await import("../../services/seed.service.js");
const { SystemUtilities } = await import("../../utils/system.util.js");

/**
 * #688: a payload row's capabilities are the same `PermissionSet.can` the
 * mutation routes `check`, evaluated over the seeded system policies.
 */
const SYSTEM = SystemUtilities.id.system;
const USER = "user-1";

let seq = 0;
const setFor = (role: "owner" | "member") => {
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
      ObjectCapabilitiesService.for(setFor("member"), "portal", {
        id: "p-2",
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

describe("ObjectCapabilitiesService.attachChildren (#829)", () => {
  const ORG = "org-1";
  beforeEach(() => {
    mockEntityFindMany.mockReset();
  });

  it("a member's own child under a writable parent gets everything, and no share", async () => {
    mockEntityFindMany.mockResolvedValue([
      { id: "e-own", organizationId: ORG, createdBy: USER },
    ]);
    const [row] = await ObjectCapabilitiesService.attachChildren(
      setFor("member"),
      ORG,
      "field_mapping",
      [{ id: "fm-1", createdBy: USER, connectorEntityId: "e-own" }]
    );
    expect(row.capabilities).toEqual({
      read: true,
      write: true,
      delete: true,
    });
  });

  it("a member's own child under a read-only parent is read-only", async () => {
    mockEntityFindMany.mockResolvedValue([
      { id: "e-sys", organizationId: ORG, createdBy: SYSTEM },
    ]);
    const [row] = await ObjectCapabilitiesService.attachChildren(
      setFor("member"),
      ORG,
      "entity_record",
      [{ id: "r-1", createdBy: USER, connectorEntityId: "e-sys" }]
    );
    expect(row.capabilities).toEqual({
      read: true,
      write: false,
      delete: false,
    });
  });

  it("looks parents up once per page, keeping rows and order", async () => {
    mockEntityFindMany.mockResolvedValue([
      { id: "e-own", organizationId: ORG, createdBy: USER },
      { id: "e-sys", organizationId: ORG, createdBy: SYSTEM },
    ]);
    const out = await ObjectCapabilitiesService.attachChildren(
      setFor("member"),
      ORG,
      "field_mapping",
      [
        { id: "a", createdBy: USER, connectorEntityId: "e-own" },
        { id: "b", createdBy: USER, connectorEntityId: "e-sys" },
        { id: "c", createdBy: USER, connectorEntityId: "e-own" },
      ]
    );
    expect(mockEntityFindMany).toHaveBeenCalledTimes(1);
    expect(out.map((r) => [r.id, r.capabilities.write])).toEqual([
      ["a", true],
      ["b", false],
      ["c", true],
    ]);
  });
});
