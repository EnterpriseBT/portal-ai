/**
 * MarketplaceService (#568) — the AWS Marketplace entitlement rail.
 *
 * `getEntitlement` is a **converge read** against the AWS Marketplace
 * Entitlement Service (`GetEntitlements`): the decision input is the calling
 * AWS account's *current* entitlement, never a notification payload, so an
 * out-of-order / redelivered SNS message resolves to the same truth. A
 * residency install runs in the customer's own AWS account, so the query
 * returns that customer's entitlement.
 *
 * Unset `AWS_MARKETPLACE_PRODUCT_CODE` ⇒ the rail is off (the webhook 404s,
 * nothing is resolved). The Entitlement Service is only in us-east-1.
 */

import {
  MarketplaceEntitlementServiceClient,
  GetEntitlementsCommand,
} from "@aws-sdk/client-marketplace-entitlement-service";

import { CommercialEventModelFactory } from "@portalai/core/models";
import type { CommercialEventOutcome } from "@portalai/core/models";
import { environment } from "../environment.js";
import { SystemUtilities } from "../utils/system.util.js";

/** The parsed AWS Marketplace SNS entitlement notification (the fields the
 *  grant source reads). The converge read is the source of truth, so only the
 *  dedup identity + audit action are needed here. */
export interface MarketplaceNotification {
  /** The SNS `MessageId` — the dedup identity (`external_id`). */
  MessageId: string;
  /** The notification action, for audit (e.g. "entitlement-updated"). */
  action?: string;
}

/** The org-relevant projection of an AWS Marketplace entitlement. */
export interface MarketplaceEntitlement {
  customerIdentifier: string;
  dimension: string;
  /** Epoch-ms term end, or null when open-ended. */
  expirationDate: number | null;
}

/**
 * Flat contract → the unlimited `enterprise` tier. A map keyed by dimension
 * leaves room for future SKUs; an unknown dimension throws so a listing
 * misconfiguration surfaces rather than silently granting.
 */
const DIMENSION_TO_TIER: Record<string, string> = { enterprise: "enterprise" };

export class MarketplaceService {
  static isConfigured(): boolean {
    return environment.AWS_MARKETPLACE_PRODUCT_CODE !== "";
  }

  static dimensionToTier(dimension: string): string {
    const tier = DIMENSION_TO_TIER[dimension];
    if (!tier) {
      throw new Error(`Unknown AWS Marketplace dimension: ${dimension}`);
    }
    return tier;
  }

  private static client(): MarketplaceEntitlementServiceClient {
    return new MarketplaceEntitlementServiceClient({
      region: environment.AWS_MARKETPLACE_REGION,
    });
  }

  /**
   * Converge read — the calling account's current entitlement for the
   * configured product. Returns `null` when there is no active entitlement
   * (unsubscribed / expired), which the grant source treats as a term lapse.
   */
  static async getEntitlement(): Promise<MarketplaceEntitlement | null> {
    const res = await this.client().send(
      new GetEntitlementsCommand({
        ProductCode: environment.AWS_MARKETPLACE_PRODUCT_CODE,
      })
    );
    const entitlement = res.Entitlements?.[0];
    if (!entitlement?.CustomerIdentifier || !entitlement.Dimension) {
      return null;
    }
    return {
      customerIdentifier: entitlement.CustomerIdentifier,
      dimension: entitlement.Dimension,
      expirationDate: entitlement.ExpirationDate
        ? entitlement.ExpirationDate.getTime()
        : null,
    };
  }

  /**
   * Build a `commercial_events` dedup row for the marketplace rail, keyed on
   * the SNS `MessageId` as its `external_id`. Mirrors `BillingService.eventRow`.
   */
  static eventRow(
    notification: MarketplaceNotification,
    fields: {
      organizationId: string | null;
      resultingTier: string | null;
      outcome: CommercialEventOutcome;
    }
  ) {
    return new CommercialEventModelFactory()
      .create(SystemUtilities.id.system)
      .update({
        source: "aws_marketplace",
        externalId: notification.MessageId,
        type: notification.action ?? "entitlement-notification",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        ...fields,
      })
      .parse();
  }
}
