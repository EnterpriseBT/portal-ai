import { describe, it, expect } from "@jest/globals";
import {
  UserRoleSchema,
  UserRoleModelFactory,
} from "../../models/user-role.model.js";

describe("UserRoleSchema (spec case 1)", () => {
  it("round-trips through the factory", () => {
    const parsed = new UserRoleModelFactory()
      .create("system")
      .update({
        userId: "user-1",
        organizationId: "org-1",
        roleId: "sysrole:org-1:admin",
      })
      .parse();
    expect(parsed.userId).toBe("user-1");
    expect(parsed.organizationId).toBe("org-1");
    expect(parsed.roleId).toBe("sysrole:org-1:admin");
    expect(parsed.createdBy).toBe("system");
    expect(UserRoleSchema.safeParse(parsed).success).toBe(true);
  });

  it("rejects a row missing userId/organizationId/roleId", () => {
    const base = {
      id: "ur-1",
      created: 1,
      createdBy: "system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      userId: "user-1",
      organizationId: "org-1",
      roleId: "role-1",
    };
    expect(UserRoleSchema.safeParse(base).success).toBe(true);
    for (const drop of ["userId", "organizationId", "roleId"] as const) {
      const bad = { ...base };
      delete (bad as Record<string, unknown>)[drop];
      expect(UserRoleSchema.safeParse(bad).success).toBe(false);
    }
  });
});
