import { describe, it, expect } from "@jest/globals";
import {
  CommercialEventSchema,
  CommercialEventSourceSchema,
  CommercialEventOutcomeSchema,
  CommercialEventModel,
  CommercialEventModelFactory,
} from "../../models/commercial-event.model.js";

// ── Helpers ──────────────────────────────────────────────────────────

const stripeFields = {
  source: "stripe" as const,
  externalId: "evt_1QxTest123",
  type: "customer.subscription.updated",
  stripeCustomerId: "cus_abc123",
  stripeSubscriptionId: "sub_abc123",
  organizationId: "org-1",
  resultingTier: "pro",
  outcome: "applied" as const,
};

const marketplaceFields = {
  source: "aws_marketplace" as const,
  externalId: "11111111-2222-3333-4444-555555555555", // SNS MessageId
  type: "entitlement-updated",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  organizationId: "org-1",
  resultingTier: "enterprise",
  outcome: "applied" as const,
};

const OUTCOMES = [
  "applied",
  "noop",
  "unmatched",
  "ignored",
  "foreign",
] as const;

// ── Tests ────────────────────────────────────────────────────────────

describe("CommercialEventSourceSchema (#568)", () => {
  it.each(["stripe", "aws_marketplace"])("accepts source %s", (source) => {
    expect(CommercialEventSourceSchema.safeParse(source).success).toBe(true);
  });

  it("rejects an unknown source", () => {
    expect(CommercialEventSourceSchema.safeParse("gcp").success).toBe(false);
  });
});

describe("CommercialEventOutcomeSchema", () => {
  it.each(OUTCOMES)("accepts outcome %s", (outcome) => {
    expect(CommercialEventOutcomeSchema.safeParse(outcome).success).toBe(true);
  });

  it("rejects an unknown outcome", () => {
    expect(CommercialEventOutcomeSchema.safeParse("exploded").success).toBe(
      false
    );
  });
});

describe("CommercialEventSchema (#568)", () => {
  // case 1 — both rails parse
  it("parses a stripe row", () => {
    const model = new CommercialEventModelFactory()
      .create("SYSTEM")
      .update(stripeFields);
    const parsed = model.parse();
    expect(parsed.source).toBe("stripe");
    expect(parsed.externalId).toBe("evt_1QxTest123");
    expect(CommercialEventSchema.safeParse(parsed).success).toBe(true);
  });

  it("parses an aws_marketplace row (null stripe audit fields)", () => {
    const model = new CommercialEventModelFactory()
      .create("SYSTEM")
      .update(marketplaceFields);
    const parsed = model.parse();
    expect(parsed.source).toBe("aws_marketplace");
    expect(parsed.stripeCustomerId).toBeNull();
    expect(parsed.resultingTier).toBe("enterprise");
    expect(CommercialEventSchema.safeParse(parsed).success).toBe(true);
  });

  it.each(OUTCOMES)(
    "round-trips through CommercialEventModelFactory with outcome %s",
    (outcome) => {
      const model = new CommercialEventModelFactory()
        .create("SYSTEM")
        .update({ ...stripeFields, outcome });
      const parsed = model.parse();
      expect(parsed.outcome).toBe(outcome);
      expect(parsed.createdBy).toBe("SYSTEM");
      expect(CommercialEventSchema.safeParse(parsed).success).toBe(true);
    }
  );

  it("rejects an unknown source", () => {
    const model = new CommercialEventModelFactory()
      .create("SYSTEM")
      .update({ ...stripeFields, source: "azure" as never });
    expect(model.validate().success).toBe(false);
  });

  it("rejects an unknown outcome", () => {
    const model = new CommercialEventModelFactory()
      .create("SYSTEM")
      .update({ ...stripeFields, outcome: "retried" as never });
    expect(model.validate().success).toBe(false);
  });

  it("accepts null linkage fields (unmatched event: no org, no tier)", () => {
    const model = new CommercialEventModelFactory().create("SYSTEM").update({
      ...stripeFields,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      organizationId: null,
      resultingTier: null,
      outcome: "unmatched",
    });
    expect(model.validate().success).toBe(true);
  });

  it("rejects a missing externalId", () => {
    const { externalId: _externalId, ...rest } = stripeFields;
    const model = new CommercialEventModelFactory()
      .create("SYSTEM")
      .update(rest);
    expect(model.validate().success).toBe(false);
  });

  it("exposes the schema via the model getter", () => {
    const model = new CommercialEventModel({});
    const shape = model.schema.shape;
    expect(shape).toHaveProperty("source");
    expect(shape).toHaveProperty("externalId");
    expect(shape).toHaveProperty("outcome");
  });
});
