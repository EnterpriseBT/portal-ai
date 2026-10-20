import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { PermissionStatementSelect } from "../../db/schema/zod.js";
import type { PermissionContext } from "../../services/permission.service.js";

/**
 * #829: objects and parts. ParentAccessService checks a part's owning entity
 * and a contained object's container, for the routes, object capabilities and
 * the agent permission gate, with the 404-before-403 split of `loadForVerb`.
 */
type Row = { id: string; organizationId: string; createdBy: string };
const mockEntityAuthRows = jest.fn<(ids: string[]) => Promise<Row[]>>();
const mockInstanceAuthRows = jest.fn<(ids: string[]) => Promise<Row[]>>();
const mockInstanceFindById = jest.fn();
const mockInstanceFindMany = jest.fn();
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorEntities: { findAuthRows: mockEntityAuthRows },
      connectorInstances: {
        findAuthRows: mockInstanceAuthRows,
        // A permission check must never read (and decrypt) a full instance.
        findById: mockInstanceFindById,
        findMany: mockInstanceFindMany,
      },
    },
  },
}));

const { ParentAccessService } =
  await import("../../services/parent-access.service.js");
const { PermissionSet } = await import("../../services/permission-set.js");
const { SEED_SYSTEM_POLICIES } = await import("../../services/seed.service.js");
const { SystemUtilities } = await import("../../utils/system.util.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

const ORG = "org-1";
const USER = "user-1";
const SYSTEM = SystemUtilities.id.system;

let seq = 0;
/** A default member: read/write/delete on their own rows, read on system rows. */
const memberSet = () => {
  const ctx: PermissionContext = {
    userId: USER,
    organizationId: ORG,
    roles: ["member"],
  };
  const statements = SEED_SYSTEM_POLICIES.filter(
    (p) => p.role === "member"
  ).flatMap((p) =>
    p.statements.map(
      (st) =>
        ({
          id: `s${seq++}`,
          organizationId: ORG,
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

const writable: Row = { id: "e-own", organizationId: ORG, createdBy: USER };
const readOnly: Row = { id: "e-sys", organizationId: ORG, createdBy: SYSTEM };
const unreadable: Row = { id: "e-other", organizationId: ORG, createdBy: "u2" };
const otherOrg: Row = { id: "e-x", organizationId: "org-2", createdBy: USER };

const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    const err = e as { status?: number; code?: string };
    return { status: err.status, code: err.code };
  }
  return null;
};

beforeEach(() => {
  mockEntityAuthRows.mockReset();
  mockInstanceAuthRows.mockReset();
  mockInstanceFindById.mockReset();
  mockInstanceFindMany.mockReset();
});

describe("ParentAccessService.firstRefusal (#829)", () => {
  it("firstRefusal reports a missing parent as not_found ahead of a denied one", async () => {
    mockEntityAuthRows.mockResolvedValue([writable, readOnly]);
    expect(
      await ParentAccessService.firstRefusal(
        memberSet(),
        ORG,
        "entity",
        [writable.id, readOnly.id, "missing"],
        "write"
      )
    ).toEqual({ id: "missing", reason: "not_found" });
    mockEntityAuthRows.mockResolvedValue([writable, readOnly]);
    expect(
      await ParentAccessService.firstRefusal(
        memberSet(),
        ORG,
        "entity",
        [writable.id, readOnly.id],
        "write"
      )
    ).toEqual({ id: readOnly.id, reason: "denied" });
    mockEntityAuthRows.mockResolvedValue([writable, readOnly]);
    expect(
      await ParentAccessService.firstRefusal(
        memberSet(),
        ORG,
        "entity",
        [writable.id, readOnly.id],
        "read"
      )
    ).toBeNull();
  });

  it("firstRefusal looks up each distinct id once, in one query", async () => {
    mockInstanceAuthRows.mockResolvedValue([writable]);
    expect(
      await ParentAccessService.firstRefusal(
        memberSet(),
        ORG,
        "connector_instance",
        [writable.id, writable.id, writable.id],
        "write"
      )
    ).toBeNull();
    expect(mockInstanceAuthRows).toHaveBeenCalledTimes(1);
    expect(mockEntityAuthRows).not.toHaveBeenCalled();
  });
});

describe("ParentAccessService parts and containers (#829)", () => {
  it("assertOwner answers read and write on the entity with the 404/403 split", () => {
    const set = memberSet();
    expect(ParentAccessService.assertOwner(set, ORG, readOnly, "read")).toBe(
      readOnly
    );
    expect(
      status(() => ParentAccessService.assertOwner(set, ORG, readOnly, "write"))
    ).toEqual({ status: 403, code: ApiCode.PERMISSION_DENIED });
    expect(
      status(() =>
        ParentAccessService.assertOwner(set, ORG, unreadable, "read")
      )
    ).toEqual({ status: 404, code: ApiCode.CONNECTOR_ENTITY_NOT_FOUND });
    expect(
      status(() => ParentAccessService.assertOwner(set, ORG, otherOrg, "read"))
    ).toEqual({ status: 404, code: ApiCode.CONNECTOR_ENTITY_NOT_FOUND });
  });

  it("loadOwner 404s a deleted (absent) entity", async () => {
    mockEntityAuthRows.mockResolvedValue([]);
    await expect(
      ParentAccessService.loadOwner(memberSet(), ORG, "e-gone", "read")
    ).rejects.toMatchObject({
      status: 404,
      code: ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
    });
  });

  it("ownerCapabilities mirrors each entity, delete = write, in one query", async () => {
    mockEntityAuthRows.mockResolvedValue([writable, readOnly, unreadable]);
    const caps = await ParentAccessService.ownerCapabilities(memberSet(), ORG, [
      writable.id,
      readOnly.id,
      unreadable.id,
      "missing",
      writable.id,
    ]);
    expect(Object.fromEntries(caps)).toEqual({
      [writable.id]: { read: true, write: true, delete: true },
      [readOnly.id]: { read: true, write: false, delete: false },
      [unreadable.id]: { read: false, write: false, delete: false },
      missing: { read: false, write: false, delete: false },
    });
    expect(mockEntityAuthRows).toHaveBeenCalledTimes(1);
  });

  it("checks an entity's container for write, without reading credentials", async () => {
    mockInstanceAuthRows.mockResolvedValue([readOnly]);
    await expect(
      ParentAccessService.loadWritableContainer(
        memberSet(),
        ORG,
        "entity",
        readOnly.id
      )
    ).rejects.toMatchObject({ status: 403, code: ApiCode.PERMISSION_DENIED });
    mockInstanceAuthRows.mockResolvedValue([writable, readOnly, otherOrg]);
    const ids = await ParentAccessService.writableContainerIds(
      memberSet(),
      ORG,
      "entity",
      [writable.id, readOnly.id, otherOrg.id]
    );
    expect([...ids]).toEqual([writable.id]);
    expect(mockInstanceFindById).not.toHaveBeenCalled();
    expect(mockInstanceFindMany).not.toHaveBeenCalled();
  });

  it("ownerIdOf reads the part's entity id", () => {
    expect(
      ParentAccessService.ownerIdOf("entity_record", {
        connectorEntityId: "e-1",
      })
    ).toBe("e-1");
    expect(ParentAccessService.ownerIdOf("field_mapping", {})).toBeNull();
  });
});
