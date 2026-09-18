import type { Request, Response, NextFunction } from "express";

import { ApplicationService } from "../services/application.service.js";
import { DbService } from "../services/db.service.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { isEntitlementExpired } from "../utils/entitlement-term.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "require-org-writable" });

/** Methods that never write — always allowed (reads are never gated). */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Mounting-relative path prefixes exempt from the write-gate even for a
 * mutating method (e.g. an action that must work while read-only). Empty today;
 * add a prefix here rather than loosening the gate.
 */
const WRITABLE_EXEMPT_PREFIXES: readonly string[] = [];

/**
 * Enforce the marketplace read-only degradation (#568). When an org's
 * entitlement term has lapsed (`entitlementThrough` in the past, derived — see
 * `entitlement-term.util`), mutating requests are rejected 403 while reads
 * continue untouched (never data loss); renewal (a future term) restores
 * writes.
 *
 * Fail policy: **fail-closed on a definitively-expired term**, but **fail-open
 * on a lookup failure** — inability to prove the term lapsed is not the same as
 * it having lapsed, so a transient org-resolution error must not 403 every
 * write for a healthy org. SaaS / non-marketplace orgs have a null term and are
 * never gated. Mounted on `protectedRouter` after `jwtCheck`.
 */
export const requireOrgWritable = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  if (SAFE_METHODS.has(req.method)) return next();
  if (WRITABLE_EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) {
    return next();
  }

  try {
    const auth0Id = req.auth?.payload.sub;
    if (!auth0Id) return next(); // no identity to gate; downstream auth handles it

    const user = await DbService.repository.users.findByAuth0Id(auth0Id);
    if (!user) return next(); // no user yet; downstream handles it

    const orgResult = await ApplicationService.getCurrentOrganization(user.id);
    const org = orgResult?.organization;

    if (org && isEntitlementExpired(org, Date.now())) {
      return next(
        new ApiError(
          403,
          ApiCode.ORG_ENTITLEMENT_EXPIRED,
          "Your marketplace entitlement has lapsed — the workspace is read-only until it is renewed."
        )
      );
    }

    return next();
  } catch (error) {
    // Fail-open: an inability to resolve the org is not proof of expiry.
    logger.warn(
      { error: error instanceof Error ? error.message : "unknown" },
      "requireOrgWritable could not resolve the org; allowing the write"
    );
    return next();
  }
};
