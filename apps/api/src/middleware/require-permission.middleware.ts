import type { Request, Response, NextFunction } from "express";

import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import {
  PermissionService,
  type PermissionAction,
} from "../services/permission.service.js";

/**
 * A **class-level** permission gate (#630) — asserts the caller's resolved
 * {@link PermissionSet} allows `action` on the resource *class* (no concrete
 * object), then `next()`s or rejects `403`. Used where a row-level
 * `visibilityPredicate` cannot apply: the toolpacks list mixes in-memory builtin
 * registry entries (not DB rows) with org rows, so its read gate is coarse.
 *
 * Distinct from per-object `PermissionService.check`, which keys on a concrete
 * object's `createdBy`. A class check passes only on an **unconditional** allow
 * (an ownership-scoped member grant never matches an object-less probe), so this
 * gate admits owner/admin (`* *`) and denies a member with no unconditional
 * grant on the type — exactly the admin-page semantics.
 *
 * **Fail-closed** (unlike `requireOrgWritable`'s degradation gate): a missing
 * metadata context denies. Must be mounted **after** `getApplicationMetadata`
 * has populated `req.application.metadata`.
 */
export function requirePermission(
  action: PermissionAction,
  resourceType: string
) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const ctx = req.application?.metadata;
      if (!ctx) {
        next(
          new ApiError(
            403,
            ApiCode.INSUFFICIENT_ROLE,
            "Your role does not permit this action"
          )
        );
        return;
      }
      const set = await PermissionService.loadSet(ctx);
      if (!set.can(action, { type: resourceType })) {
        next(
          new ApiError(
            403,
            ApiCode.INSUFFICIENT_ROLE,
            "Your role does not permit this action"
          )
        );
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
