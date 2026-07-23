import type {
  BillingTiersGetResponse,
  BillingCheckoutRequest,
  BillingCheckoutResponse,
  BillingPortalRequest,
  BillingPortalResponse,
} from "@portalai/core/contracts";
import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const billing = {
  /** The self-serve plan list (#176) — selectable tiers with live Stripe
   *  prices (price is null when not purchasable or display-degraded). */
  tiers: (options?: QueryOptions<BillingTiersGetResponse>) =>
    useAuthQuery<BillingTiersGetResponse>(
      queryKeys.billing.tiers(),
      "/api/billing/tiers",
      undefined,
      options
    ),
  /** Owner-only: mint a hosted Checkout session for a tier. The variables
   *  ARE the request body ({ tier }); consumers `window.location.replace`
   *  the returned URL. The webhook — never the redirect — writes the tier,
   *  so no cache invalidation here. */
  checkout: () =>
    useAuthMutation<BillingCheckoutResponse, BillingCheckoutRequest>({
      url: "/api/billing/checkout",
      method: "POST",
    }),
  /** Owner-only: mint a hosted Billing Portal session. The variables ARE the
   *  body — `{}` opens Manage, `{ tier }` opens the subscription-update flow
   *  for that plan (#260). Consumers `window.location.replace` the URL; the
   *  webhook — never the redirect — writes the tier. */
  portal: () =>
    useAuthMutation<BillingPortalResponse, BillingPortalRequest>({
      url: "/api/billing/portal",
      method: "POST",
    }),
};
