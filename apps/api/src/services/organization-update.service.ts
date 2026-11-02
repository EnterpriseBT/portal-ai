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
 * manual reconciliation. It sends the org's name as stored when it runs, so
 * two renames whose syncs finish out of order still leave Stripe current.
 */

import type { Organization } from "@portalai/core/models";

import type { DbClient } from "../db/repositories/base.repository.js";
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

export interface OrganizationUpdateOptions {
  /** Runs in the transaction after the row lock and before the write; throw
   *  to refuse. The route checks the default station here, so a station
   *  deleted concurrently can't be written as the default (its delete clears
   *  the default under the same row lock). */
  beforeWrite?: (tx: DbClient) => Promise<void>;
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
    userId: string,
    options: OrganizationUpdateOptions = {}
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

      await options.beforeWrite?.(tx);

      // The patch is the parsed request, so it holds only the keys sent.
      const organization = (await DbService.repository.organizations.update(
        orgId,
        { ...patch, updated: Date.now(), updatedBy: userId },
        tx
      ))!;
      return {
        organization: organization as Organization,
        previousName: current.name,
      };
    });
  }

  /**
   * Post-commit, best effort. A no-op without a Stripe customer or when Stripe
   * isn't configured; a failure is logged and never thrown. A rename that
   * lands while the first checkout is creating the customer is synced by that
   * checkout (`BillingService.createCheckout`, #938).
   */
  static async syncStripeCustomerName(organizationId: string): Promise<void> {
    if (!StripeService.isConfigured()) return;
    let stripeCustomerId: string | null = null;
    try {
      const current =
        await DbService.repository.organizations.findById(organizationId);
      stripeCustomerId = current?.stripeCustomerId ?? null;
      if (!current || !stripeCustomerId) return;
      await StripeService.updateCustomerName(stripeCustomerId, current.name);
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
