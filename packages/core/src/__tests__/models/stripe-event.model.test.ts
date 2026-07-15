import { describe, it, expect } from "@jest/globals";
import {
  StripeEventSchema,
  StripeEventOutcomeSchema,
  StripeEventModel,
  StripeEventModelFactory,
} from "../../models/stripe-event.model.js";

// ── Helpers ──────────────────────────────────────────────────────────

const validFields = {
  eventId: "evt_1QxTest123",
  type: "customer.subscription.updated",
  stripeCustomerId: "cus_abc123",
  stripeSubscriptionId: "sub_abc123",
  organizationId: "org-1",
  resultingTier: "pro",
  outcome: "applied" as const,
};

const OUTCOMES = ["applied", "noop", "unmatched", "ignored"] as const;

// ── Tests ────────────────────────────────────────────────────────────

describe("StripeEventOutcomeSchema", () => {
  it.each(OUTCOMES)("accepts outcome %s", (outcome) => {
    expect(StripeEventOutcomeSchema.safeParse(outcome).success).toBe(true);
  });

  it("rejects an unknown outcome", () => {
    expect(StripeEventOutcomeSchema.safeParse("exploded").success).toBe(false);
  });
});

describe("StripeEventSchema", () => {
  it.each(OUTCOMES)(
    "round-trips through StripeEventModelFactory with outcome %s",
    (outcome) => {
      const model = new StripeEventModelFactory()
        .create("SYSTEM")
        .update({ ...validFields, outcome });
      const parsed = model.parse();

      expect(parsed.eventId).toBe("evt_1QxTest123");
      expect(parsed.outcome).toBe(outcome);
      expect(parsed.createdBy).toBe("SYSTEM");
      expect(StripeEventSchema.safeParse(parsed).success).toBe(true);
    }
  );

  it("rejects an unknown outcome", () => {
    const model = new StripeEventModelFactory()
      .create("SYSTEM")
      .update({ ...validFields, outcome: "retried" as never });
    expect(model.validate().success).toBe(false);
  });

  it("accepts null linkage fields (unmatched event: no org, no tier)", () => {
    const model = new StripeEventModelFactory().create("SYSTEM").update({
      ...validFields,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      organizationId: null,
      resultingTier: null,
      outcome: "unmatched",
    });
    const result = model.validate();
    expect(result.success).toBe(true);
  });

  it("rejects a missing eventId", () => {
    const { eventId: _eventId, ...rest } = validFields;
    const model = new StripeEventModelFactory().create("SYSTEM").update(rest);
    expect(model.validate().success).toBe(false);
  });

  it("exposes the schema via the model getter", () => {
    const model = new StripeEventModel({});
    const shape = model.schema.shape;
    expect(shape).toHaveProperty("eventId");
    expect(shape).toHaveProperty("outcome");
  });
});
