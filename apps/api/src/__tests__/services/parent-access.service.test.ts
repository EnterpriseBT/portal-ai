import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { PermissionStatementSelect } from "../../db/schema/zod.js";
import type { PermissionContext } from "../../services/permission.service.js";

/**
 * #829: a child write requires write on its parent. ParentAccessService is the
 * one helper the routes, object capabilities and the agent permission gate use
 * to check it, with the 404-before-403 split of `loadForVerb`.
 */
type Row = { id: string; organizationId: string; createdBy: string };
const mockEntityFindById = jest.fn<(id: string) => Promise<Row | undefined>>();
const mockEntityFindMany = jest.fn<(where: unknown) => Promise<Row[]>>();
const mockInstanceFindMany = jest.fn<(where: unknown) => Promise<Row[]>>();
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorEntities: {
        findById: mockEntityFindById,
        findMany: mockEntityFindMany,
      },
      connectorInstances: {
        findById: jest.fn(),
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
  mockEntityFindById.mockReset();
  mockEntityFindMany.mockReset();
  mockInstanceFindMany.mockReset();
});

describe("ParentAccessService.assertWritableParent (#829)", () => {
  it("returns a writable parent", () => {
    expect(
      ParentAccessService.assertWritableParent(
        memberSet(),
        ORG,
        "field_mapping",
        writable
      )
    ).toBe(writable);
  });

  it("answers a parent in another org with the parent's 404", () => {
    expect(
      status(() =>
        ParentAccessService.assertWritableParent(
          memberSet(),
          ORG,
          "entity_record",
          otherOrg
        )
      )
    ).toEqual({ status: 404, code: ApiCode.CONNECTOR_ENTITY_NOT_FOUND });
  });

  it("answers an unreadable parent with 404, the connector's code for an entity", () => {
    expect(
      status(() =>
        ParentAccessService.assertWritableParent(
          memberSet(),
          ORG,
          "entity",
          unreadable
        )
      )
    ).toEqual({ status: 404, code: ApiCode.CONNECTOR_INSTANCE_NOT_FOUND });
  });

  it("answers a read-only parent with 403 PERMISSION_DENIED", () => {
    expect(
      status(() =>
        ParentAccessService.assertWritableParent(
          memberSet(),
          ORG,
          "field_mapping",
          readOnly
        )
      )
    ).toEqual({ status: 403, code: ApiCode.PERMISSION_DENIED });
  });
});

describe("ParentAccessService batch checks (#829)", () => {
  it("writableParentIds keeps only in-org, readable, writable parents", async () => {
    mockEntityFindMany.mockResolvedValue([
      writable,
      readOnly,
      unreadable,
      otherOrg,
    ]);
    const ids = await ParentAccessService.writableParentIds(
      memberSet(),
      ORG,
      "entity_record",
      [writable.id, readOnly.id, unreadable.id, otherOrg.id, "missing"]
    );
    expect([...ids]).toEqual([writable.id]);
    expect(mockEntityFindMany).toHaveBeenCalledTimes(1);
  });

  it("firstRefusal reports a missing parent as not_found ahead of a denied one", async () => {
    mockEntityFindMany.mockResolvedValue([writable, readOnly]);
    expect(
      await ParentAccessService.firstRefusal(
        memberSet(),
        ORG,
        "entity",
        [writable.id, readOnly.id, "missing"],
        "write"
      )
    ).toEqual({ id: "missing", reason: "not_found" });
    mockEntityFindMany.mockResolvedValue([writable, readOnly]);
    expect(
      await ParentAccessService.firstRefusal(
        memberSet(),
        ORG,
        "entity",
        [writable.id, readOnly.id],
        "write"
      )
    ).toEqual({ id: readOnly.id, reason: "denied" });
    mockEntityFindMany.mockResolvedValue([writable, readOnly]);
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
    mockInstanceFindMany.mockResolvedValue([writable]);
    expect(
      await ParentAccessService.firstRefusal(
        memberSet(),
        ORG,
        "connector_instance",
        [writable.id, writable.id, writable.id],
        "write"
      )
    ).toBeNull();
    expect(mockInstanceFindMany).toHaveBeenCalledTimes(1);
    expect(mockEntityFindMany).not.toHaveBeenCalled();
  });
});
