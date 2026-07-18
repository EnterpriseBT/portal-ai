/**
 * Stripe seams for `tier apply` (#218). Deliberately READ-ONLY: apply
 * resolves lookup keys to env-local price ids; it never creates, mutates,
 * or rotates prices — pricing's record of truth is Stripe, and price
 * changes are a Stripe-side runbook act (see COMMANDS.md → tier).
 */

import Stripe from "stripe";

import {
  EnvNotConfiguredError,
  getSecret,
  type EnvironmentDefinition,
} from "@portalai/cli-env";

/** Mirror of `apps/api/src/services/stripe.service.ts:21` — keep pinned. */
export const STRIPE_API_VERSION = "2026-06-24.dahlia";

/** A declared `stripeLookupKey` with no price in the env's account —
 *  apply fails closed before any DB write. */
export class TierApplyMissingPricesError extends Error {
  constructor(public readonly missingLookupKeys: string[]) {
    super(
      `No Stripe price found for lookup key(s): ${missingLookupKeys.join(", ")}. ` +
        `Create the price(s) in this environment's Stripe account first ` +
        `(COMMANDS.md → tier runbook), then re-run apply.`
    );
    this.name = "TierApplyMissingPricesError";
  }
}

export type SecretReader = (
  def: EnvironmentDefinition,
  name: string
) => Promise<string>;

/**
 * Per-env Stripe secret key: `local` (aws: null) reads
 * `process.env.STRIPE_SECRET_KEY`; AWS envs read the `stripe-secret-key`
 * secret (the config-catalog entry). A read-only restricted key (`rk_`,
 * prices read) is the recommended key type — apply never writes to Stripe.
 */
export async function resolveStripeKey(
  def: EnvironmentDefinition,
  readSecret: SecretReader = getSecret
): Promise<string> {
  if (def.aws === null) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new EnvNotConfiguredError(
        `Environment "${def.name}" needs STRIPE_SECRET_KEY in the process env`
      );
    }
    return key;
  }
  return readSecret(def, "stripe-secret-key");
}

/** Resolve lookup keys → env-local price ids. Injectable for tests. */
export type PriceResolver = (
  stripeKey: string,
  lookupKeys: string[]
) => Promise<Map<string, string>>;

/** Default resolver: one `prices.list` call over the official SDK. */
export const stripePriceResolver: PriceResolver = async (
  stripeKey,
  lookupKeys
) => {
  const resolved = new Map<string, string>();
  if (lookupKeys.length === 0) return resolved;

  const stripe = new Stripe(stripeKey, {
    apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
  });
  const prices = await stripe.prices.list({
    lookup_keys: lookupKeys,
    active: true,
    limit: 100,
  });
  for (const price of prices.data) {
    if (price.lookup_key) resolved.set(price.lookup_key, price.id);
  }
  return resolved;
};
