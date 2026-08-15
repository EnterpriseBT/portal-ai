/**
 * The Stripe webhook's event contract (#385).
 *
 * Almost all of #385 is Stripe-account configuration, which cannot be tested
 * from here. This is the one seam that can drift: the code consumes a set of
 * event types, and a runbook tells an operator which types to subscribe the
 * endpoint to. Nothing otherwise connects the two.
 *
 * The drift that matters is not the obvious one. `price.*` events change no
 * tier state — they are recorded `ignored` — so they read as optional. They
 * are not: each first delivery fires the marketing-site rebuild that
 * republishes amounts baked into static HTML. An endpoint subscribed to only
 * the three `customer.subscription.*` types works perfectly for billing and
 * silently leaves the public pricing page stale forever.
 *
 * So: pin both sets, and (in the runbook-coverage case) assert the operator
 * instruction lists exactly what the code consumes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "@jest/globals";

import { STRIPE_SUBSCRIPTION_EVENTS } from "../routes/webhook.router.js";
import { STRIPE_PRICE_EVENTS } from "../services/billing.service.js";

describe("Stripe webhook event contract (#385)", () => {
  it("handles exactly the three subscription lifecycle events", () => {
    expect([...STRIPE_SUBSCRIPTION_EVENTS].sort()).toEqual([
      "customer.subscription.created",
      "customer.subscription.deleted",
      "customer.subscription.updated",
    ]);
  });

  it("treats exactly the three price events as rebuild triggers", () => {
    expect([...STRIPE_PRICE_EVENTS].sort()).toEqual([
      "price.created",
      "price.deleted",
      "price.updated",
    ]);
  });

  it("keeps the two sets disjoint", () => {
    // A type in both would be routed to handleSubscriptionEvent AND expected
    // to fire a rebuild — but only recordIgnoredEvent fires one, so the
    // rebuild would never happen. That is a bug, not a redundancy.
    const overlap = [...STRIPE_SUBSCRIPTION_EVENTS].filter((t) =>
      STRIPE_PRICE_EVENTS.has(t)
    );
    expect(overlap).toEqual([]);
  });

  it("pins the union at six — the endpoint's subscription list", () => {
    // A count pin so adding a consumed type is a deliberate act: it fails
    // here, which forces the runbook (and the live endpoint) to be updated
    // rather than silently under-covering the new type.
    const union = new Set([
      ...STRIPE_SUBSCRIPTION_EVENTS,
      ...STRIPE_PRICE_EVENTS,
    ]);
    expect(union.size).toBe(6);
  });
});

// The half of the contract that lives outside the code. Slice 1 pinned what
// the code consumes; this asserts the operator instruction covers it, which
// is the only thing standing between "we added an event type" and "the live
// endpoint silently never receives it".
describe("the runbook documents the endpoint's full subscription (#385)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const runbook = path.resolve(
    here,
    "../../../../docs/PROD_STRIPE_LIVE.runbook.md"
  );

  it.each([...STRIPE_SUBSCRIPTION_EVENTS, ...STRIPE_PRICE_EVENTS])(
    "names %s",
    (eventType) => {
      expect(fs.existsSync(runbook)).toBe(true);
      expect(fs.readFileSync(runbook, "utf8")).toContain(eventType);
    }
  );
});
