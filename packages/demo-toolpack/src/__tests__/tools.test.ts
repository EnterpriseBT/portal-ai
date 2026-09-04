import {
  TOOLS,
  dispatchTool,
  quoteShippingRate,
  creditCheck,
} from "../tools.js";

describe("demo-toolpack tools — catalog", () => {
  it("exposes exactly the two demo tools with valid slugs", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "quote_shipping_rate",
      "credit_check",
    ]);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]{0,62}$/);
      expect(t.parameterSchema.type).toBe("object");
      expect(t.capability.pure).toBe(true);
    }
  });
});

describe("quote_shipping_rate", () => {
  it("returns the deterministic quote for a known input", () => {
    expect(
      quoteShippingRate({
        origin_site_id: "SITE-001",
        dest_site_id: "SITE-009",
        weight_kg: 250,
      })
    ).toEqual({
      origin_site_id: "SITE-001",
      dest_site_id: "SITE-009",
      weight_kg: 250,
      distance_miles: 1997,
      quoted_rate_usd: 136.46,
      transit_days: 4,
      service: "freight",
    });
  });

  it("is symmetric in the site pair (A→B quotes the same distance as B→A)", () => {
    const ab = quoteShippingRate({
      origin_site_id: "SITE-002",
      dest_site_id: "SITE-013",
      weight_kg: 80,
    });
    const ba = quoteShippingRate({
      origin_site_id: "SITE-013",
      dest_site_id: "SITE-002",
      weight_kg: 80,
    });
    expect(ab.distance_miles).toBe(ba.distance_miles);
    expect(ab.quoted_rate_usd).toBe(ba.quoted_rate_usd);
  });

  it("rejects invalid input", () => {
    expect(() =>
      quoteShippingRate({
        origin_site_id: "SITE-001",
        dest_site_id: "SITE-009",
      })
    ).toThrow();
    expect(() =>
      quoteShippingRate({
        origin_site_id: "SITE-001",
        dest_site_id: "SITE-009",
        weight_kg: -5,
      })
    ).toThrow();
  });
});

describe("credit_check", () => {
  it("returns the deterministic result for a known customer", () => {
    expect(creditCheck({ customer_id: "CUST-00001" })).toEqual({
      customer_id: "CUST-00001",
      credit_score: 719,
      risk_band: "good",
      approved: true,
      credit_limit_usd: 13000,
    });
  });

  it("keeps the score in [300, 850] and bands/approval consistent", () => {
    for (let i = 1; i <= 200; i++) {
      const id = `CUST-${String(i).padStart(5, "0")}`;
      const r = creditCheck({ customer_id: id });
      expect(r.credit_score).toBeGreaterThanOrEqual(300);
      expect(r.credit_score).toBeLessThanOrEqual(850);
      expect(r.approved).toBe(r.credit_score >= 620);
      if (!r.approved) expect(r.credit_limit_usd).toBe(0);
    }
  });

  it("rejects a missing customer_id", () => {
    expect(() => creditCheck({})).toThrow();
  });
});

describe("dispatchTool", () => {
  it("routes to each tool", () => {
    expect(dispatchTool("credit_check", { customer_id: "CUST-00001" })).toEqual(
      {
        status: 200,
        body: expect.objectContaining({ credit_score: 719 }),
      }
    );
    expect(
      dispatchTool("quote_shipping_rate", {
        origin_site_id: "SITE-001",
        dest_site_id: "SITE-009",
        weight_kg: 250,
      }).status
    ).toBe(200);
  });

  it("400s bad input, 404s an unknown tool, 400s a non-string tool", () => {
    expect(dispatchTool("credit_check", {}).status).toBe(400);
    expect(dispatchTool("nope", {}).status).toBe(404);
    expect(dispatchTool(42, {}).status).toBe(400);
  });
});
