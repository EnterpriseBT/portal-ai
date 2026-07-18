/**
 * `tier apply` (#218) — slice 2 seams: per-env Stripe key resolution +
 * the price-resolver contract. Slice 3 extends this file with the
 * tierApply command cases.
 */

import { jest } from "@jest/globals";
import { BUILTIN_ENVIRONMENTS, EnvNotConfiguredError } from "@portalai/cli-env";

import { resolveStripeKey, TierApplyMissingPricesError } from "../stripe.js";
import { lookupKey } from "../catalog.js";

const local = BUILTIN_ENVIRONMENTS["local"];
const appDev = BUILTIN_ENVIRONMENTS["app-dev"];

// ── spec case 8 — resolveStripeKey ────────────────────────────────────

describe("resolveStripeKey (#218)", () => {
  const ORIGINAL = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = ORIGINAL;
  });

  it("local (aws: null) reads STRIPE_SECRET_KEY from the process env", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_local_123";
    await expect(resolveStripeKey(local)).resolves.toBe("sk_test_local_123");
  });

  it("local without the env var typed-throws EnvNotConfiguredError", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await expect(resolveStripeKey(local)).rejects.toBeInstanceOf(
      EnvNotConfiguredError
    );
  });

  it("aws env delegates to the secret reader with the catalog leaf name", async () => {
    const readSecret = jest.fn(async () => "sk_test_appdev_456");
    await expect(resolveStripeKey(appDev, readSecret as never)).resolves.toBe(
      "sk_test_appdev_456"
    );
    expect(readSecret).toHaveBeenCalledWith(appDev, "stripe-secret-key");
  });
});

// ── the config-catalog pin ────────────────────────────────────────────

describe("STRIPE_SECRET_KEY config-catalog entry (#218)", () => {
  it("resolves as a Secrets Manager entry with the stripe-secret-key leaf", () => {
    const entry = lookupKey("STRIPE_SECRET_KEY");
    expect(entry.kind).toBe("secret");
    expect(entry.name).toBe("stripe-secret-key");
  });
});

// ── the missing-prices error shape ────────────────────────────────────

describe("TierApplyMissingPricesError (#218)", () => {
  it("names every missing lookup key and the runbook", () => {
    const err = new TierApplyMissingPricesError(["pro", "scale"]);
    expect(err.missingLookupKeys).toEqual(["pro", "scale"]);
    expect(err.message).toContain("pro");
    expect(err.message).toContain("scale");
    expect(err.message).toMatch(/create the price/i);
  });
});
