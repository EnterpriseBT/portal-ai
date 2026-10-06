import { describe, it, expect } from "@jest/globals";

import { PermissionSet } from "../../services/permission-set.js";
import { ObjectAccessService } from "../../services/object-access.service.js";
import { SEED_SYSTEM_POLICIES } from "../../services/seed.service.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { SystemUtilities } from "../../utils/system.util.js";
import type { PermissionContext } from "../../services/permission.service.js";
import type { PermissionStatementSelect } from "../../db/schema/zod.js";

/**
 * #713: `loadForVerb` is the one place "unreadable == absent" is decided for
 * a by-id write. An object that's missing, in another org or unreadable
 * answers the route's own 404; a readable one the caller may not change
 * answers 403; a permitted one comes back narrowed.
 */
const SYSTEM = SystemUtilities.id.system;
const ORG = "org-1";
const USER = "user-1";

let seq = 0;
const statement = (
  st: Pick<
    PermissionStatementSelect,
    "effect" | "verb" | "resourceType" | "condition"
  > & { resourceId?: string | null }
): PermissionStatementSelect =>
  ({
    id: `s${seq++}`,
    organizationId: ORG,
    policyId: "p",
    effect: st.effect,
    verb: st.verb,
    resourceType: st.resourceType,
    resourceId: st.resourceId ?? null,
    condition: st.condition,
    conditionParam: null,
    created: 1,
    createdBy: SYSTEM,
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  }) as PermissionStatementSelect;

/** The seeded member policy, plus any extra statements (e.g. a share). */
const memberSet = (extra: PermissionStatementSelect[] = []): PermissionSet => {
  const ctx: PermissionContext = {
    userId: USER,
    organizationId: ORG,
    roles: ["member"],
  };
  const seeded = SEED_SYSTEM_POLICIES.filter(
    (p) => p.role === "member"
  ).flatMap((p) => p.statements.map((st) => statement(st)));
  return new PermissionSet(ctx, [...seeded, ...extra]);
};

const notFound = () =>
  new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found");

const station = (
  over: Partial<{ organizationId: string; createdBy: string }> = {}
) => ({
  id: "st-1",
  organizationId: ORG,
  createdBy: "someone-else",
  name: "s",
  ...over,
});

function thrown(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("expected a throw");
}

describe("ObjectAccessService.loadForVerb (#713)", () => {
  it("a missing row is the route's 404", () => {
    const e = thrown(() =>
      ObjectAccessService.loadForVerb(
        memberSet(),
        ORG,
        "station",
        null,
        "write",
        notFound
      )
    );
    expect([e.status, e.code]).toEqual([404, ApiCode.STATION_NOT_FOUND]);
  });

  it("a row in another org is the route's 404, even the caller's own", () => {
    const e = thrown(() =>
      ObjectAccessService.loadForVerb(
        memberSet(),
        ORG,
        "station",
        station({ organizationId: "org-2", createdBy: USER }),
        "write",
        notFound
      )
    );
    expect([e.status, e.code]).toEqual([404, ApiCode.STATION_NOT_FOUND]);
  });

  it("an unreadable same-org row is the route's 404, not a 403", () => {
    for (const verb of ["write", "delete", "share"] as const) {
      const e = thrown(() =>
        ObjectAccessService.loadForVerb(
          memberSet(),
          ORG,
          "station",
          station(),
          verb,
          notFound
        )
      );
      expect([verb, e.status, e.code]).toEqual([
        verb,
        404,
        ApiCode.STATION_NOT_FOUND,
      ]);
    }
  });

  it("a readable row the caller may not change is a 403 naming the permission", () => {
    const readShare = statement({
      effect: "allow",
      verb: "read",
      resourceType: "station",
      resourceId: "st-1",
      condition: null,
    });
    const e = thrown(() =>
      ObjectAccessService.loadForVerb(
        memberSet([readShare]),
        ORG,
        "station",
        station(),
        "write",
        notFound
      )
    );
    expect([e.status, e.code, e.message]).toEqual([
      403,
      ApiCode.PERMISSION_DENIED,
      "You don't have permission to edit this station.",
    ]);
  });

  it("a permitted row comes back", () => {
    const own = station({ createdBy: USER });
    expect(
      ObjectAccessService.loadForVerb(
        memberSet(),
        ORG,
        "station",
        own,
        "delete",
        notFound
      )
    ).toBe(own);
  });
});
