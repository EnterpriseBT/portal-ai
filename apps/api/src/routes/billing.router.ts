/**
 * Billing router (#176) — the self-serve subscription surface, mounted on
 * the protected router at `/billing`.
 *
 * All three routes resolve the caller's current org (same helper the
 * organization router uses); the owner checks live in `BillingService`.
 */

import { Router, Request, Response, NextFunction } from "express";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApplicationService } from "../services/application.service.js";
import { BillingService } from "../services/billing.service.js";
import { DbService } from "../services/db.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";
import {
  BillingCheckoutRequestSchema,
  type BillingTiersGetResponse,
  type BillingCheckoutResponse,
  type BillingPortalResponse,
} from "@portalai/core/contracts";
import type { OrganizationSelect, UserSelect } from "../db/schema/zod.js";

const logger = createLogger({ module: "billing-router" });

export const billingRouter = Router();

/** Resolve the authed caller's user row + current organization, or throw
 *  the same 404s the organization router uses. */
async function resolveCallerOrg(
  req: Request
): Promise<{ user: UserSelect; organization: OrganizationSelect }> {
  const auth0Id = req.auth?.payload.sub as string;
  const user = await DbService.repository.users.findByAuth0Id(auth0Id);
  if (!user) {
    throw new ApiError(
      404,
      ApiCode.ORGANIZATION_USER_NOT_FOUND,
      "User not found"
    );
  }
  const result = await ApplicationService.getCurrentOrganization(user.id);
  if (!result) {
    throw new ApiError(
      404,
      ApiCode.ORGANIZATION_NOT_FOUND,
      "No organization found for user"
    );
  }
  return { user, organization: result.organization };
}

/**
 * @openapi
 * /api/billing/tiers:
 *   get:
 *     tags:
 *       - Billing
 *     summary: List the self-serve subscription plans
 *     description: >
 *       Every `selectable` tier visible to the caller's organization (public
 *       tiers plus that org's private custom tiers) as a whole-tier object —
 *       display name, the full tier policy (per-cost-class allocations with
 *       per-minute rates, per-tool caps, overage, billing period, toolpack
 *       entitlements), an operator-authored blurb, a `cta`
 *       (`subscribe | contact | none`), and its live Stripe price (null for a
 *       non-`subscribe` tier or when the price lookup is degraded by a Stripe
 *       outage). Accessible to any member of the organization.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Plan list retrieved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BillingTiersGetResponse'
 *       401:
 *         description: Unauthenticated
 *       404:
 *         description: User or organization not found
 */
billingRouter.get(
  "/tiers",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { organization } = await resolveCallerOrg(req); // membership check
      const tiers = await BillingService.listBillingTiers(organization.id);
      return HttpService.success<BillingTiersGetResponse>(res, { tiers });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to list billing tiers"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.ORGANIZATION_FETCH_FAILED,
              "Failed to list billing tiers"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/billing/checkout:
 *   post:
 *     tags:
 *       - Billing
 *     summary: Start a hosted Stripe Checkout session (owner only)
 *     description: >
 *       Mints a Stripe-hosted Checkout session URL for the requested tier.
 *       Guards in order: billing configured (503), caller is the org owner
 *       (403), org not already subscribed (409), org not on a managed custom
 *       tier (409), tier exists and is listed (404), tier carries a Stripe
 *       price (400). The org's Stripe customer is created lazily on first
 *       checkout. The webhook — never this redirect — writes the tier.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BillingCheckoutRequest'
 *     responses:
 *       200:
 *         description: Hosted checkout session created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BillingCheckoutResponse'
 *       400:
 *         description: Invalid payload, or the tier is not purchasable
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Caller is not the organization owner
 *       404:
 *         description: User, organization, or tier not found
 *       409:
 *         description: Already subscribed, or the plan is managed
 *       502:
 *         description: Stripe checkout call failed
 *       503:
 *         description: Billing not configured in this environment
 */
billingRouter.post(
  "/checkout",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = BillingCheckoutRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.BILLING_INVALID_PAYLOAD,
            "Invalid checkout payload — expected { tier: string }"
          )
        );
      }
      const { user, organization } = await resolveCallerOrg(req);
      const result = await BillingService.createCheckout(
        organization,
        user.id,
        parsed.data.tier
      );
      return HttpService.success<BillingCheckoutResponse>(res, result);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to create checkout session"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              502,
              ApiCode.BILLING_CHECKOUT_FAILED,
              "Could not start checkout — please try again"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/billing/portal:
 *   post:
 *     tags:
 *       - Billing
 *     summary: Open the Stripe Billing Portal (owner only)
 *     description: >
 *       Mints a Stripe-hosted Billing Portal session URL — plan changes,
 *       payment methods, invoices, and cancellation are all Stripe-hosted.
 *       Requires the org to have a Stripe customer (409 otherwise).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Hosted portal session created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BillingPortalResponse'
 *       401:
 *         description: Unauthenticated
 *       403:
 *         description: Caller is not the organization owner
 *       404:
 *         description: User or organization not found
 *       409:
 *         description: The organization has no billing account yet
 *       502:
 *         description: Stripe portal call failed
 *       503:
 *         description: Billing not configured in this environment
 */
billingRouter.post(
  "/portal",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { user, organization } = await resolveCallerOrg(req);
      const result = await BillingService.createPortal(organization, user.id);
      return HttpService.success<BillingPortalResponse>(res, result);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to create portal session"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              502,
              ApiCode.BILLING_PORTAL_FAILED,
              "Could not open the billing portal — please try again"
            )
      );
    }
  }
);
