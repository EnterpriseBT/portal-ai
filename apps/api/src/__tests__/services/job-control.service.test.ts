import { describe, it, expect } from "@jest/globals";

import { PermissionSet } from "../../services/permission-set.js";
import { JobControlService } from "../../services/job-control.service.js";
import { JobPayloadRedactionService } from "../../services/job-payload-redaction.service.js";
import { SEED_SYSTEM_POLICIES } from "../../services/seed.service.js";
import { SystemUtilities } from "../../utils/system.util.js";
import type { PermissionContext } from "../../services/permission.service.js";
import type { PermissionStatementSelect } from "../../db/schema/zod.js";

/**
 * #689: one rule decides who controls a job — the cancel route, payload
 * redaction and the job `capabilities` all read it — evaluated here over the
 * seeded system policies.
 */
const SYSTEM = SystemUtilities.id.system;
const USER = "user-1";

let seq = 0;
const forRole = (
  role: "owner" | "member"
): { ctx: PermissionContext; set: PermissionSet } => {
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
  return { ctx, set: new PermissionSet(ctx, statements) };
};

describe("JobControlService (#689)", () => {
  it("a member controls their own job", () => {
    const { ctx, set } = forRole("member");
    expect(JobControlService.canControl(ctx, set, { createdBy: USER })).toBe(
      true
    );
    expect(
      JobControlService.capabilities(ctx, set, { createdBy: USER })
    ).toEqual({ read: true, write: false, delete: true });
  });

  it("a member doesn't control another's job", () => {
    const { ctx, set } = forRole("member");
    expect(
      JobControlService.capabilities(ctx, set, { createdBy: "someone-else" })
    ).toEqual({ read: true, write: false, delete: false });
  });

  it("the owner controls any job (unconditional job control)", () => {
    const { ctx, set } = forRole("owner");
    expect(
      JobControlService.canControl(ctx, set, { createdBy: "someone-else" })
    ).toBe(true);
  });

  it("payload redaction follows the same rule", () => {
    for (const role of ["owner", "member"] as const) {
      const { ctx, set } = forRole(role);
      for (const createdBy of [USER, "someone-else"]) {
        expect(
          JobPayloadRedactionService.canSeePayload(ctx, set, { createdBy })
        ).toBe(JobControlService.canControl(ctx, set, { createdBy }));
      }
    }
  });
});
