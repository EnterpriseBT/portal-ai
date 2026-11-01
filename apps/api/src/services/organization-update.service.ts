/**
 * Organization settings writes (#907) for `PATCH /api/organization/:id`.
 *
 * `apply` writes only the fields the caller sent, under a row lock, and returns
 * the name it replaced so the route's `org.update` audit entry records what
 * this write actually changed (two concurrent renames each see the other's
 * result, never the same stale name). Authorization is the route's job; this
 * service assumes it has already run.
 *
 * `syncStripeCustomerName` runs after commit and is best effort: the rename is
 * the record of truth, and a stale Stripe name is cosmetic and logged for
 * manual reconciliation.
 */

import type { Organization } from "@portalai/core/models";

import { DbService } from "./db.service.js";
import { StripeService } from "./stripe.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "organization-update" });

export interface OrganizationUpdatePatch {
  name?: string;
  defaultStationId?: string | null;
}

export interface OrganizationUpdateResult {
  organization: Organization;
  previousName: string;
}

export class OrganizationUpdateService {
  /**
   * One transaction: lock the row, read its name, write only the present
   * fields plus `updated`/`updatedBy`, and return the row with the name it
   * replaced. A missing or deleted org is `404 ORGANIZATION_NOT_FOUND`.
   */
  static async apply(
    orgId: string,
    patch: OrganizationUpdatePatch,
    userId: string
  ): Promise<OrganizationUpdateResult> {
    return DbService.transaction(async (tx) => {
      const current =
        await DbService.repository.organizations.findByIdForUpdate(orgId, tx);
      if (!current) {
        throw new ApiError(
          404,
          ApiCode.ORGANIZATION_NOT_FOUND,
          "Organization not found"
        );
      }

      const changes: OrganizationUpdatePatch = {};
      if (patch.name !== undefined) changes.name = patch.name;
      if (patch.defaultStationId !== undefined)
        changes.defaultStationId = patch.defaultStationId;

      const organization = await DbService.repository.organizations.update(
        orgId,
        { ...changes, updated: Date.now(), updatedBy: userId },
        tx
      );
      if (!organization) {
        throw new ApiError(
          404,
          ApiCode.ORGANIZATION_NOT_FOUND,
          "Organization not found"
        );
      }
      return {
        organization: organization as Organization,
        previousName: current.name,
      };
    });
  }

  /**
   * Post-commit, best effort. A no-op without a Stripe customer or when Stripe
   * isn't configured; a failure is logged and never thrown.
   */
  static async syncStripeCustomerName(
    organization: Organization
  ): Promise<void> {
    const { id: organizationId, stripeCustomerId, name } = organization;
    if (!stripeCustomerId || !StripeService.isConfigured()) return;
    try {
      await StripeService.updateCustomerName(stripeCustomerId, name);
    } catch (error) {
      logger.warn(
        {
          organizationId,
          stripeCustomerId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Failed to update the Stripe customer name after an organization rename — reconcile manually"
      );
    }
  }
}
