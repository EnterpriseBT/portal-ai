import { describe, it, expect } from "@jest/globals";
import type { OrgRole } from "@portalai/core/models";

import {
  PermissionService,
  type PermissionAction,
  type PermissionContext,
} from "../../services/permission.service.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { SystemUtilities } from "../../utils/system.util.js";

// setup.ts sets SYSTEM_ID = "SYSTEM_ID_TEST", so this is deterministic.
const SYSTEM_ID = SystemUtilities.id.system;

function ctx(role: OrgRole, userId = "user-1"): PermissionContext {
  return { userId, organizationId: "org-1", role };
}

const PRIVILEGED: PermissionAction[] = [
  "billing.manage",
  "org.delete",
  "org.audit.read",
  "member.role.assign",
];

// ── Tests (spec cases 8–12) ──────────────────────────────────────────

describe("PermissionService.check", () => {
  it("owner is allowed every action (case 8)", () => {
    const actions: PermissionAction[] = [...PRIVILEGED, "resource.write"];
    for (const action of actions) {
      expect(() =>
        PermissionService.check(ctx("owner"), action, {
          type: "station",
          createdBy: "someone-else",
        })
      ).not.toThrow();
    }
  });

  it("admin is denied billing.manage and org.delete, allowed the rest (case 9)", () => {
    expect(() =>
      PermissionService.check(ctx("admin"), "billing.manage")
    ).toThrow(ApiError);
    expect(() => PermissionService.check(ctx("admin"), "org.delete")).toThrow(
      ApiError
    );
    for (const action of ["org.audit.read", "member.role.assign"] as const) {
      expect(() => PermissionService.check(ctx("admin"), action)).not.toThrow();
    }
    // admin sees any resource regardless of creator
    expect(() =>
      PermissionService.check(ctx("admin"), "resource.write", {
        type: "station",
        createdBy: "someone-else",
      })
    ).not.toThrow();
  });

  it("member: resource.* only on own createdBy; read (not write) on system rows; no privileged actions (case 10)", () => {
    const me = ctx("member", "me");

    // own object → read + write allowed
    expect(() =>
      PermissionService.check(me, "resource.read", {
        type: "station",
        createdBy: "me",
      })
    ).not.toThrow();
    expect(() =>
      PermissionService.check(me, "resource.write", {
        type: "station",
        createdBy: "me",
      })
    ).not.toThrow();

    // another user's object → denied both
    expect(() =>
      PermissionService.check(me, "resource.read", {
        type: "station",
        createdBy: "other",
      })
    ).toThrow(ApiError);
    expect(() =>
      PermissionService.check(me, "resource.write", {
        type: "station",
        createdBy: "other",
      })
    ).toThrow(ApiError);

    // system-created object → read allowed, write denied (OQ1)
    expect(() =>
      PermissionService.check(me, "resource.read", {
        type: "station",
        createdBy: SYSTEM_ID,
      })
    ).not.toThrow();
    expect(() =>
      PermissionService.check(me, "resource.write", {
        type: "station",
        createdBy: SYSTEM_ID,
      })
    ).toThrow(ApiError);

    // all privileged actions denied
    for (const action of PRIVILEGED) {
      expect(() => PermissionService.check(me, action)).toThrow(ApiError);
    }
  });

  it("throws ApiError with 403 and the mapped code (case 12)", () => {
    const expectDeny = (
      role: OrgRole,
      action: PermissionAction,
      code: ApiCode
    ) => {
      try {
        PermissionService.check(ctx(role), action);
        throw new Error("expected a deny");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(403);
        expect((err as ApiError).code).toBe(code);
      }
    };
    expectDeny("admin", "billing.manage", ApiCode.BILLING_NOT_OWNER);
    expectDeny("admin", "org.delete", ApiCode.ORGANIZATION_NOT_OWNER);
    expectDeny("member", "org.audit.read", ApiCode.INSUFFICIENT_ROLE);
  });

  it("fails closed on an unresolved role", () => {
    expect(() =>
      PermissionService.check(ctx("ghost" as OrgRole), "resource.read", {
        type: "station",
        createdBy: "me",
      })
    ).toThrow(ApiError);
  });
});

describe("PermissionService.visibilityPredicate (case 11)", () => {
  // A stand-in column marker; the predicate only needs a column reference.
  const createdByCol = { name: "created_by" } as never;

  it("returns undefined for owner and admin (unrestricted)", () => {
    expect(
      PermissionService.visibilityPredicate(ctx("owner"), { createdByCol })
    ).toBeUndefined();
    expect(
      PermissionService.visibilityPredicate(ctx("admin"), { createdByCol })
    ).toBeUndefined();
  });

  it("returns a predicate for member (own + system-created)", () => {
    const predicate = PermissionService.visibilityPredicate(ctx("member"), {
      createdByCol,
    });
    expect(predicate).toBeDefined();
  });
});
