/**
 * Resolves the `policyIds` a group or role payload bundles (#681), shared by
 * {@link GroupService} and {@link RoleService}.
 *
 * Every id must name a live policy in the caller's organization. Before #681
 * an unknown id reached the `policy_attachments` insert and failed its FK
 * (a 500), and another org's policy id was attached outright. The refusal is
 * the same whether an id is absent, deleted or another org's, so it reveals
 * nothing about other tenants. Then the attacher must hold everything the
 * bundled policies grant (the union boundary: bundling can't escalate).
 */

import { DbService } from "./db.service.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";
import { RbacObjectResolver } from "./rbac-object-resolver.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

export class RbacPolicyRefsService {
  /**
   * Returns `policyIds` deduplicated, in first-seen order, once each is known
   * to be a live policy in the caller's org within the caller's boundary.
   * Throws 400 `RBAC_POLICY_UNKNOWN` (naming every unknown id) or 403
   * `RBAC_POLICY_EXCEEDS_BOUNDARY`, before anything is written.
   */
  static async assertAttachable(
    caller: PermissionContext,
    policyIds: string[]
  ): Promise<string[]> {
    const ids = [...new Set(policyIds)];
    if (ids.length === 0) return ids;

    const found = new Set(
      (
        await DbService.repository.permissionPolicies.findByIdsInOrg(
          caller.organizationId,
          ids
        )
      ).map((p) => p.id)
    );
    const unknown = ids.filter((id) => !found.has(id));
    if (unknown.length > 0) {
      throw new ApiError(
        400,
        ApiCode.RBAC_POLICY_UNKNOWN,
        `Unknown policy id(s): ${unknown.map((id) => `"${id}"`).join(", ")}`
      );
    }

    const statements =
      await DbService.repository.permissionStatements.findByPolicyIds(
        caller.organizationId,
        ids
      );
    const set = await PermissionService.loadSet(caller);
    await set.assertStatementsWithinBoundary(statements, (rt, rid) =>
      RbacObjectResolver.resolveCreatedBy(caller.organizationId, rt, rid)
    );
    return ids;
  }
}
